"""Structural tests for issue #800: automated dependency updates gated on CI.

Acceptance criteria under test:

1. Configure Renovate (or equivalent) to open PRs for outdated dependencies
   across npm and cargo ecosystems, gated on CI passing.
2. Establish a cadence (e.g. weekly) for reviewing and merging these PRs.

The repository already ran Dependabot, so the deliverables are the Renovate
configuration (which takes over routine version bumps), the narrowing of
Dependabot to security updates so the two do not race, and a CI gate that
dependency pull requests must satisfy.

These tests are deliberately structural — they assert the configuration that
makes the behaviour true, because none of it can be exercised without the
Renovate app being installed on the repository.
"""

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RENOVATE = REPO_ROOT / "renovate.json"
DEPENDABOT = REPO_ROOT / ".github" / "dependabot.yml"
GATE_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "dependency-update-gate.yml"
DOC = REPO_ROOT / "docs" / "dependency-updates.md"


def _read(path):
    return path.read_text(encoding="utf-8")


class TestRenovateConfiguration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = _read(RENOVATE)
        cls.config = json.loads(cls.raw)

    def test_config_is_present_and_valid_json(self):
        """Renovate reads renovate.json as JSON, so it has to parse strictly."""
        self.assertIsInstance(self.config, dict)
        self.assertGreater(len(self.config), 0)

    def test_covers_both_npm_and_cargo(self):
        """Acceptance: outdated dependencies across the npm and cargo ecosystems."""
        managers = self.config.get("enabledManagers") or []
        self.assertIn("npm", managers)
        self.assertIn("cargo", managers)

    def test_bot_never_merges_on_its_own(self):
        """Acceptance: updates are gated on CI passing, so merging is a human act."""
        self.assertFalse(
            self.config.get("automerge"),
            "automerge must be false — the CI gate is what protects main",
        )
        self.assertFalse(self.config.get("platformAutomerge"))

    def test_no_package_rule_re_enables_automerge(self):
        for rule in self.config.get("packageRules", []):
            self.assertFalse(
                rule.get("automerge"),
                f"packageRule {rule.get('description', rule)!r} re-enables automerge",
            )

    def test_schedule_is_weekly(self):
        """Acceptance: a cadence for reviewing and merging."""
        schedule = " ".join(self.config.get("schedule") or [])
        self.assertRegex(schedule.lower(), r"monday|week", "Renovate should run weekly")

    def test_majors_are_isolated_from_routine_bumps(self):
        types = {
            tuple(rule.get("matchUpdateTypes") or [])
            for rule in self.config.get("packageRules", [])
        }
        self.assertIn(("major",), types, "major updates must be grouped separately")
        self.assertIn(("minor", "patch"), types)

    def test_every_package_rule_documents_itself(self):
        for rule in self.config.get("packageRules", []):
            self.assertTrue(
                rule.get("description"),
                f"packageRule {rule!r} has no description",
            )

    def test_contract_dependency_is_isolated(self):
        """soroban-sdk pins the contract against a ledger protocol version."""
        names = {
            name
            for rule in self.config.get("packageRules", [])
            for name in rule.get("matchPackageNames") or []
        }
        self.assertIn("soroban-sdk", names)

    def test_lockfile_maintenance_is_enabled(self):
        self.assertTrue(self.config.get("lockFileMaintenance", {}).get("enabled"))


class TestDependabotIsNarrowedToSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = _read(DEPENDABOT)

    def test_every_ecosystem_entry_disables_version_updates(self):
        """open-pull-requests-limit: 0 keeps security updates, drops version updates."""
        limits = re.findall(r"open-pull-requests-limit:\s*(\d+)", self.text)
        self.assertGreater(len(limits), 0, "no open-pull-requests-limit entries found")
        self.assertEqual(
            set(limits),
            {"0"},
            "every entry must set open-pull-requests-limit: 0 so Renovate is the only "
            "tool opening routine version updates",
        )

    def test_no_entry_still_claims_version_updates(self):
        self.assertNotIn(
            "applies-to: version-updates",
            self.text,
            "a version-updates group would still fire and compete with Renovate",
        )

    def test_security_groups_are_scoped_to_security_updates(self):
        self.assertIn("applies-to: security-updates", self.text)

    def test_scope_is_documented_at_the_top_of_the_file(self):
        head = self.text[:1200].lower()
        self.assertIn("security updates only", head)
        self.assertIn("renovate", head)


class TestDependencyUpdateGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = _read(GATE_WORKFLOW)

    def test_workflow_exists_and_runs_on_pull_requests(self):
        self.assertRegex(self.text, r"on:\s*\n\s*pull_request:")
        self.assertRegex(self.text, r"branches:\s*\[main, dev\]")

    def _job_block(self, job):
        """Return the YAML block for `job`, up to the next top-level job."""
        match = re.search(rf"^  {re.escape(job)}:\n(.*?)(?=^  \S|\Z)", self.text, re.MULTILINE | re.DOTALL)
        self.assertIsNotNone(match, f"workflow has no `{job}` job")
        return match.group(1)

    def test_lockfile_integrity_job_is_the_blocking_one(self):
        block = self._job_block("lockfile-integrity")
        self.assertNotIn(
            "continue-on-error",
            block,
            "the lockfile job must be blocking; only the test suite is advisory",
        )

    def test_checks_npm_lockfiles_with_a_dry_run(self):
        self.assertIn("npm ci --dry-run", self.text)

    def test_checks_the_cargo_lockfile(self):
        self.assertIn("cargo metadata --locked", self.text)

    def test_covers_every_workspace_that_commits_a_lockfile(self):
        for directory in ["backend", "frontend", "sdk", "load-test"]:
            self.assertIn(
                directory,
                self.text,
                f"{directory} has a committed lockfile and must be checked",
            )

    def test_test_suite_job_is_advisory_and_says_why(self):
        """It cannot be blocking while the suite is red on main — and must say so."""
        self.assertIn("continue-on-error: true", self.text)
        self.assertIn(
            "ADVISORY",
            self.text,
            "the advisory job must explain why it is not yet blocking",
        )

    def test_test_suite_job_runs_for_dependency_bots_only(self):
        self.assertRegex(self.text, r"dependabot\[bot\]")
        self.assertRegex(self.text, r"renovate\[bot\]")

    def test_documents_the_pre_existing_failures_that_keep_it_advisory(self):
        for marker in ["assetMetadataValidation", "supertest", "test_issue_748"]:
            self.assertIn(
                marker,
                self.text,
                f"the workflow must name the pre-existing failure {marker!r}",
            )


class TestCadenceIsDocumented(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(DOC)

    def test_doc_exists_and_is_linked_from_contributing(self):
        self.assertTrue(DOC.is_file())
        self.assertIn("docs/dependency-updates.md", _read(REPO_ROOT / "CONTRIBUTING.md"))

    def test_documents_a_weekly_review_cadence(self):
        """Acceptance: establish a cadence for reviewing and merging."""
        self.assertRegex(self.doc, r"(?i)weekly")
        self.assertIn("Dependency Dashboard", self.doc)

    def test_documents_the_one_tool_per_job_split(self):
        self.assertIn("Renovate", self.doc)
        self.assertIn("Dependabot", self.doc)
        self.assertRegex(self.doc, r"(?i)one tool per job")

    def test_documents_the_renovate_activation_step(self):
        """The config is inert until the app is installed; that must be stated."""
        self.assertRegex(self.doc, r"(?i)install")

    def test_documents_the_rollback_if_renovate_is_not_installed(self):
        self.assertRegex(
            self.doc,
            r"(?i)revert",
            "leaving Renovate uninstalled and Dependabot at 0 would stop version updates",
        )

    def test_documents_the_schedule_and_automerge_settings(self):
        for setting in ["schedule", "automerge", "rangeStrategy"]:
            self.assertIn(setting, self.doc)


if __name__ == "__main__":
    unittest.main()
