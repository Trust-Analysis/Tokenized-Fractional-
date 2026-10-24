"""Tests for issue #907: Husky pre-commit/commit-msg hooks and CI parity enforcement.

Acceptance criteria under test:
1. Confirm every check performed by the Husky hooks is also independently
   enforced as a required CI status check, so hooks are purely a local
   convenience/fast-feedback layer rather than the only enforcement mechanism.
2. Document this explicitly in CONTRIBUTING.md so contributors understand
   hooks are not a substitute for CI passing.
"""

import json
import os
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
HUSKY_DIR = REPO_ROOT / ".husky"
PRE_COMMIT = HUSKY_DIR / "pre-commit"
COMMIT_MSG = HUSKY_DIR / "commit-msg"
WORKFLOW_PR = REPO_ROOT / ".github" / "workflows" / "pr.yml"
WORKFLOW_GITLEAKS = REPO_ROOT / ".github" / "workflows" / "gitleaks.yml"
BRANCH_PROTECTION = REPO_ROOT / ".github" / "branch-protection.json"
CONTRIBUTING = REPO_ROOT / "CONTRIBUTING.md"


def _read(path):
    return path.read_text(encoding="utf-8")


class TestHuskyHooksConfig(unittest.TestCase):
    def test_husky_directory_and_hooks_exist(self):
        self.assertTrue(HUSKY_DIR.is_dir(), ".husky directory must exist")
        self.assertTrue(PRE_COMMIT.is_file(), ".husky/pre-commit hook must exist")
        self.assertTrue(COMMIT_MSG.is_file(), ".husky/commit-msg hook must exist")

    def test_commit_msg_runs_commitlint(self):
        content = _read(COMMIT_MSG)
        self.assertIn("commitlint", content, "commit-msg must invoke commitlint")

    def test_pre_commit_runs_gitleaks_and_lint_staged(self):
        content = _read(PRE_COMMIT)
        self.assertIn("gitleaks", content, "pre-commit hook must run gitleaks")
        self.assertIn("lint-staged", content, "pre-commit hook must run lint-staged")


class TestCIHooksParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pr_ci = _read(WORKFLOW_PR)
        cls.gitleaks_ci = _read(WORKFLOW_GITLEAKS)
        cls.branch_protection = json.loads(_read(BRANCH_PROTECTION))
        cls.required_checks = cls.branch_protection["required_status_checks"]["contexts"]

    def test_ci_enforces_commitlint(self):
        self.assertIn("Commit Message Linting", self.pr_ci)
        self.assertIn("commitlint", self.pr_ci)

    def test_ci_enforces_secret_scanning(self):
        self.assertTrue(
            "TruffleHog" in self.pr_ci or "gitleaks" in self.gitleaks_ci,
            "CI must enforce secret scanning independent of local pre-commit hook",
        )

    def test_ci_enforces_lint_and_syntax(self):
        self.assertIn("Lint and Formatting Enforcement", self.pr_ci)
        self.assertIn("node --check", self.pr_ci)

    def test_required_status_checks_include_husky_parity_checks(self):
        self.assertIn("Commit Message Linting (commitlint)", self.required_checks)
        self.assertIn("Lint and Formatting Enforcement", self.required_checks)
        self.assertIn("gitleaks", self.required_checks)


class TestDocumentation(unittest.TestCase):
    def test_contributing_documents_husky_ci_parity(self):
        content = _read(CONTRIBUTING)
        self.assertIn("Git Hooks and CI Enforcement", content)
        self.assertIn("purely a local convenience", content)
        self.assertIn("never a substitute for passing CI", content)
        self.assertIn("commitlint", content)
        self.assertIn("gitleaks", content)
        self.assertIn("lint-staged", content)


if __name__ == "__main__":
    unittest.main()
