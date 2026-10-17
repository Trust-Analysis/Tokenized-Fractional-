"""Tests for issue #798: confirmed branch protection on `main`.

Acceptance criteria under test:

1. Branch protection on `main`: require at least one review, require CI checks
   to pass, disallow force-pushes.
2. The required review/merge process is documented in `CONTRIBUTING.md`.

Branch protection cannot be enabled from a file, so the repository keeps the
desired state in `.github/branch-protection.json` and ships a script that
applies and verifies it. The most valuable assertion here is the cross-check
that every required status check names a job that actually exists: a typo or a
renamed job would otherwise leave `main` permanently unmergeable.
"""

import json
import os
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
POLICY = REPO_ROOT / ".github" / "branch-protection.json"
SCRIPT = REPO_ROOT / "scripts" / "branch-protection.sh"
DOC = REPO_ROOT / "docs" / "branch-protection.md"
CONTRIBUTING = REPO_ROOT / "CONTRIBUTING.md"
WORKFLOWS = REPO_ROOT / ".github" / "workflows"


def _read(path):
    return path.read_text(encoding="utf-8")


def _job_names(path):
    """Job display names (`    name: ...`) declared by a workflow file."""
    return re.findall(r"(?m)^    name:\s*(.+?)\s*$", _read(path))


def _workflow_jobs_by_file():
    jobs = {}
    for path in sorted(WORKFLOWS.glob("*.yml")):
        names = _job_names(path)
        if names:
            jobs[path.name] = names
    return jobs


def _is_path_filtered(path):
    """True when the workflow's triggers carry a `paths:` filter."""
    text = _read(path)
    match = re.search(r"(?ms)^on:\n(.*?)^jobs:", text)
    return bool(match) and "paths:" in match.group(1)


class TestDesiredState(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.policy = json.loads(_read(POLICY))

    def test_policy_file_exists_and_is_valid_json(self):
        self.assertTrue(POLICY.is_file(), ".github/branch-protection.json is missing")

    def test_requires_at_least_one_approving_review(self):
        reviews = self.policy["required_pull_request_reviews"]
        self.assertGreaterEqual(reviews["required_approving_review_count"], 1)

    def test_dismisses_stale_approvals(self):
        reviews = self.policy["required_pull_request_reviews"]
        self.assertTrue(
            reviews["dismiss_stale_reviews"],
            "an approval for an older revision must not carry over",
        )

    def test_requires_status_checks_and_an_up_to_date_branch(self):
        checks = self.policy["required_status_checks"]
        self.assertTrue(checks["strict"], "the branch must be up to date before merging")
        self.assertGreater(len(checks["contexts"]), 0, "no status checks are required")

    def test_disallows_force_pushes_and_deletions(self):
        self.assertFalse(self.policy["allow_force_pushes"])
        self.assertFalse(self.policy["allow_deletions"])

    def test_applies_to_admins(self):
        self.assertTrue(
            self.policy["enforce_admins"],
            "the rules must not be advisory for maintainers",
        )


class TestRequiredChecksExist(unittest.TestCase):
    """A required check that never reports blocks every pull request forever."""

    @classmethod
    def setUpClass(cls):
        cls.policy = json.loads(_read(POLICY))
        cls.jobs_by_file = _workflow_jobs_by_file()
        cls.all_jobs = {name for names in cls.jobs_by_file.values() for name in names}
        cls.required = cls.policy["required_status_checks"]["contexts"]

    def test_every_required_check_names_a_real_job(self):
        missing = [c for c in self.required if c not in self.all_jobs]
        self.assertEqual(
            missing,
            [],
            f"required status checks that no workflow produces: {missing}",
        )

    def test_no_check_is_required_twice(self):
        self.assertEqual(len(self.required), len(set(self.required)))

    def test_path_filtered_workflows_are_not_required(self):
        """Those checks never run on unrelated PRs, so requiring them deadlocks."""
        offenders = []
        for path in sorted(WORKFLOWS.glob("*.yml")):
            if not _is_path_filtered(path):
                continue
            for name in _job_names(path):
                if name in self.required:
                    offenders.append(f"{name} ({path.name})")
        self.assertEqual(offenders, [], f"path-filtered checks must not be required: {offenders}")


class TestApplyAndVerifyScript(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(SCRIPT)

    def test_exists_and_is_executable(self):
        self.assertTrue(SCRIPT.is_file(), "scripts/branch-protection.sh is missing")
        self.assertTrue(os.access(SCRIPT, os.X_OK), "the script must be executable")

    def test_fails_fast(self):
        self.assertIn("set -euo pipefail", self.source)

    def test_uses_the_gh_api_and_the_checked_in_policy(self):
        self.assertIn("gh api", self.source)
        self.assertIn("branch-protection.json", self.source)

    def test_supports_apply_and_check(self):
        self.assertRegex(self.source, r"apply\)")
        self.assertRegex(self.source, r"check\)")

    def test_check_exits_non_zero_on_drift(self):
        self.assertRegex(self.source, r"exit 1")

    def test_verifies_the_settings_that_matter(self):
        for needle in [
            "required_approving_review_count",
            "required_status_checks",
            "allow_force_pushes",
            "allow_deletions",
        ]:
            self.assertIn(needle, self.source, f"the check must verify {needle}")


class TestPolicyIsDocumented(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(DOC)
        cls.flat = " ".join(cls.doc.lower().split())

    def test_doc_exists(self):
        self.assertTrue(DOC.is_file(), "docs/branch-protection.md is missing")

    def test_documents_the_core_settings(self):
        for phrase in ["at least one", "status check", "force push", "delete"]:
            self.assertIn(phrase, self.flat, f"the doc should explain {phrase!r}")

    def test_documents_the_apply_and_verify_commands(self):
        self.assertIn("branch-protection.sh apply", self.doc)
        self.assertIn("branch-protection.sh check", self.doc)

    def test_explains_why_path_filtered_checks_are_not_required(self):
        self.assertRegex(self.flat, r"path[- ]filtered")


class TestContributingDocumentsTheProcess(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(CONTRIBUTING)
        cls.flat = " ".join(cls.doc.lower().split())

    def test_has_a_review_and_merge_section(self):
        self.assertRegex(self.doc, r"(?mi)^##\s+Review and Merge Requirements")

    def test_requires_an_approval_and_green_ci(self):
        section = self.doc.split("## Review and Merge Requirements", 1)[1]
        flat = " ".join(section.lower().split())
        self.assertIn("approval", flat)
        self.assertIn("status check", flat)

    def test_links_the_branch_protection_doc(self):
        self.assertIn("docs/branch-protection.md", self.doc)

    def test_states_that_main_is_protected(self):
        section = self.doc.split("## Review and Merge Requirements", 1)[1]
        self.assertRegex(section, r"(?i)protected")

    def test_listed_in_the_table_of_contents(self):
        self.assertIn("(#review-and-merge-requirements)", self.doc)


if __name__ == "__main__":
    unittest.main()
