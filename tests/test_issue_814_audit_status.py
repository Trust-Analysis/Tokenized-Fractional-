"""Tests for issue #814: documented third-party security audit status.

Acceptance criteria under test:

1. A clear statement in `SECURITY.md` and the `README` of the contract's
   current audit status (audited / unaudited / audit planned).
2. If unaudited, a prominent risk disclaimer for anyone considering a mainnet
   deployment.
3. A policy for re-auditing after significant contract changes.

These are documentation tests. They assert the *contract* the docs make with a
reader — that the status is stated once, unambiguously, and is consistent
between the two files — rather than exact prose.
"""

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
README = REPO_ROOT / "README.md"
SECURITY = REPO_ROOT / "SECURITY.md"


def _read(path):
    return path.read_text(encoding="utf-8")


def _collapsed(text):
    """Markdown wraps lines; compare on collapsed whitespace."""
    return " ".join(text.lower().split())


class TestSecurityPolicyStatesTheStatus(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(SECURITY)
        cls.flat = _collapsed(cls.doc)

    def test_has_a_dedicated_audit_status_section(self):
        self.assertRegex(
            self.doc,
            r"(?mi)^##\s+Smart Contract Audit Status",
            "SECURITY.md must have a dedicated audit-status section",
        )

    def test_states_that_the_contract_is_unaudited(self):
        section = self.doc.split("## Smart Contract Audit Status", 1)[1]
        self.assertIn(
            "unaudited",
            section.lower(),
            "the status must be stated explicitly, not implied",
        )
        self.assertRegex(section, r"UNAUDITED", "state the status plainly and prominently")

    def test_says_there_is_no_independent_review(self):
        self.assertRegex(self.flat, r"(no|not).{0,40}independent")

    def test_does_not_claim_an_audit_report_that_does_not_exist(self):
        """A link to a report that was never published would be worse than none."""
        section = self.doc.split("## Smart Contract Audit Status", 1)[1]
        # Any markdown link must not be presented as the audit report.
        self.assertNotRegex(
            section,
            r"\[[^\]]*audit[^\]]*report[^\]]*\]\([^)]+\)",
            "do not link an audit report while the contract is unaudited",
        )

    def test_scopes_the_status_to_the_components(self):
        section = self.doc.split("## Smart Contract Audit Status", 1)[1]
        self.assertIn("contracts/", section)
        self.assertIn("backend/", section)


class TestMainnetDisclaimer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(SECURITY)
        cls.section = cls.doc.split("## Smart Contract Audit Status", 1)[1]

    def test_warns_against_an_unaudited_mainnet_deployment(self):
        self.assertRegex(self.section, r"(?i)mainnet")
        self.assertRegex(
            self.section,
            r"(?i)do not deploy|at your own risk|accepted risk",
            "the disclaimer must tell the reader what to do, not just flag a fact",
        )

    def test_explains_what_is_at_risk(self):
        self.assertRegex(
            self.section,
            r"(?i)fund|payment|withdraw",
            "the disclaimer must name the financial exposure",
        )

    def test_is_prominent_not_buried(self):
        """The disclaimer block should be a callout, so it reads as a warning."""
        self.assertRegex(self.section, r"(?m)^>")


class TestReAuditPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(SECURITY)
        cls.section = cls.doc.split("## Smart Contract Audit Status", 1)[1]

    def test_documents_a_re_audit_policy(self):
        self.assertRegex(self.section, r"(?i)re-?audit")

    def test_lists_concrete_triggers(self):
        policy = self.section.split("Re-audit policy", 1)[1]
        numbered = [
            line for line in policy.splitlines() if re.match(r"^\s*\d+\.\s+\S", line)
        ]
        self.assertGreaterEqual(
            len(numbered),
            4,
            "the policy needs concrete triggers, not a vague 'as needed'",
        )

    def test_triggers_cover_the_dangerous_surfaces(self):
        policy = _collapsed(self.section.split("Re-audit policy", 1)[1])
        for surface in ["buy_shares", "admin", "storage"]:
            self.assertIn(surface, policy, f"re-audit triggers should mention {surface}")


class TestReadmeSurfacesTheStatus(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(README)
        cls.flat = _collapsed(cls.doc)

    def test_readme_states_the_audit_status(self):
        self.assertRegex(self.doc, r"(?mi)^##\s+Security & Audit Status")
        self.assertRegex(self.flat, r"unaudited")

    def test_readme_links_the_security_policy(self):
        self.assertIn("SECURITY.md", self.doc)

    def test_readme_carries_the_mainnet_warning(self):
        self.assertRegex(
            self.doc,
            r"\[!WARNING\]",
            "the mainnet risk should be a visible callout in the README",
        )
        section = self.doc.split("## Security & Audit Status", 1)[1]
        self.assertRegex(section, r"(?i)mainnet")

    def test_readme_and_security_agree_on_the_status(self):
        """Two files that disagree about the audit status are worse than one."""
        readme_section = _collapsed(self.doc.split("## Security & Audit Status", 1)[1])
        security_section = _collapsed(_read(SECURITY).split("## Smart Contract Audit Status", 1)[1])
        self.assertIn("unaudited", readme_section)
        self.assertIn("unaudited", security_section)


if __name__ == "__main__":
    unittest.main()
