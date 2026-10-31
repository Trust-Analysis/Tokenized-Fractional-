"""Structural tests for issue #799: CODEOWNERS review routing.

Acceptance criteria under test:

1. Add a `.github/CODEOWNERS` file assigning `contracts/**` and
   security-relevant backend paths to specific maintainers.
2. Combine with the branch-protection issue to require CODEOWNERS approval on
   those paths specifically.

Criterion 2 is a repository setting, not a file, so it is verified here as
*documented* rather than as applied: the runbook must name every switch an admin
has to flip, including the one that turns these reviewers from requested into
required. On the pre-change tree every test below fails because the file does
not exist.
"""

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CODEOWNERS = REPO_ROOT / ".github" / "CODEOWNERS"
OWNERSHIP_DOC = REPO_ROOT / "docs" / "code-ownership.md"

# Paths the issue names explicitly, plus the rest of the security-relevant
# backend surface. Each must be owned by at least one account.
REQUIRED_PATHS = [
    "contracts/",
    "backend/auth.js",
    "backend/authMiddleware.js",
    "backend/src/middleware/",
    "backend/src/routes/",
]


def _read(path):
    return path.read_text(encoding="utf-8")


def _rules():
    """Parse CODEOWNERS into (pattern, [owners]) pairs, in file order."""
    rules = []
    for raw in _read(CODEOWNERS).splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        rules.append((parts[0], parts[1:]))
    return rules


class TestCodeownersFileExists(unittest.TestCase):
    def test_file_is_present(self):
        self.assertTrue(
            CODEOWNERS.is_file(),
            ".github/CODEOWNERS does not exist — GitHub will not request any reviewer",
        )

    def test_file_parses_and_is_not_empty(self):
        rules = _rules()
        self.assertGreater(len(rules), 0, "CODEOWNERS contains no rules")

    def test_every_rule_names_at_least_one_owner(self):
        """A pattern with no owner is legal but matches nothing useful."""
        for pattern, owners in _rules():
            self.assertTrue(owners, f"rule {pattern!r} names no owner")

    def test_every_owner_is_an_account_reference(self):
        for pattern, owners in _rules():
            for owner in owners:
                self.assertTrue(
                    owner.startswith("@"),
                    f"rule {pattern!r}: {owner!r} is not an @account or @org/team reference",
                )


class TestCriticalPathsAreOwned(unittest.TestCase):
    def test_each_required_path_is_covered(self):
        """Acceptance: contracts/** and security-relevant backend paths are owned.

        GitHub applies the LAST matching pattern, so a required path counts as
        owned if any rule's pattern matches it.
        """
        rules = _rules()
        for required in REQUIRED_PATHS:
            matching = [
                (pattern, owners)
                for pattern, owners in rules
                if pattern == required
                or required.startswith(pattern.rstrip("*"))
                or pattern == f"{required}**"
            ]
            self.assertTrue(
                matching,
                f"no CODEOWNERS rule matches {required!r}",
            )
            # The last match wins; that is the one that actually applies.
            _, owners = matching[-1]
            self.assertTrue(owners, f"{required!r} resolves to a rule with no owner")


class TestDefaultRuleComesFirst(unittest.TestCase):
    def test_first_rule_is_the_catch_all(self):
        """Broadest-first ordering is what makes the specific rules effective."""
        first_pattern, _ = _rules()[0]
        self.assertEqual(
            first_pattern,
            "*",
            "the catch-all `*` must be the first rule, otherwise the last-match-wins "
            "ordering silently overrides every specific rule below it",
        )


class TestOwnersAreMaintainers(unittest.TestCase):
    def test_every_owner_is_named_in_the_ownership_doc(self):
        doc = _read(OWNERSHIP_DOC)
        for _, owners in _rules():
            for owner in owners:
                self.assertIn(
                    owner,
                    doc,
                    f"{owner} owns paths in CODEOWNERS but is not listed in docs/code-ownership.md",
                )

    def test_ownership_doc_names_the_paths_the_issue_names(self):
        doc = _read(OWNERSHIP_DOC)
        self.assertIn("contracts/", doc)
        self.assertIn("backend/src/middleware/", doc)


class TestBranchProtectionIsDocumented(unittest.TestCase):
    """Acceptance criterion 2 — documented, since it is an admin action."""

    def test_ownership_doc_states_that_codeowners_is_not_enforcing_by_itself(self):
        doc = _read(OWNERSHIP_DOC)
        self.assertRegex(
            doc,
            r"(does not make their approval \*\*required\*\*|not make their approval|request\b)",
            "the doc must be explicit that CODEOWNERS requests rather than requires a review",
        )

    def test_ownership_doc_names_the_required_code_owners_switch(self):
        doc = _read(OWNERSHIP_DOC)
        self.assertIn(
            "Require review from Code Owners",
            doc,
            "the doc must name the exact branch-protection setting that enforces ownership",
        )

    def test_ownership_doc_covers_the_other_required_protections(self):
        doc = _read(OWNERSHIP_DOC)
        for setting in [
            "Require a pull request before merging",
            "Require approvals",
            "Require status checks to pass before merging",
            "Do not allow bypassing the above settings",
        ]:
            self.assertIn(setting, doc, f"branch-protection step {setting!r} is not documented")

    def test_ownership_doc_defers_to_the_admin_rather_than_claiming_it_is_done(self):
        # Markdown wraps lines, so compare on collapsed whitespace.
        doc = " ".join(_read(OWNERSHIP_DOC).lower().split())
        self.assertIn("admin", doc)
        self.assertIn("cannot be shipped in a pull request", doc)


class TestContributingReferencesOwnership(unittest.TestCase):
    def test_contributing_points_at_the_ownership_runbook(self):
        contributing = _read(REPO_ROOT / "CONTRIBUTING.md")
        self.assertIn("docs/code-ownership.md", contributing)

    def test_contributing_lists_the_security_relevant_backend_paths(self):
        contributing = _read(REPO_ROOT / "CONTRIBUTING.md")
        self.assertIn("backend/src/middleware/", contributing)
        self.assertRegex(contributing, r"contracts/`")


if __name__ == "__main__":
    unittest.main()
