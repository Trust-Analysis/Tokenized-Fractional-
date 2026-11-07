"""Tests for issue #795: a unified, cross-tier incident-response playbook.

Acceptance criteria under test:

1. A single `docs/incident-response.md` covers the full coordinated sequence
   across all three tiers (contract, backend, DNS/CDN), with clear ownership and
   communication steps.
2. It is written in a checklist format suitable for use during a live incident.
"""

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DOC = REPO_ROOT / "docs" / "incident-response.md"
TROUBLESHOOTING = REPO_ROOT / "docs" / "troubleshooting.md"
SECURITY = REPO_ROOT / "docs" / "security.md"
BLUE_GREEN = REPO_ROOT / "docs" / "blue-green-deployment.md"
README = REPO_ROOT / "README.md"


def _read(path):
    return path.read_text(encoding="utf-8")


class TestPlaybookExistsAndIsOrdered(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(DOC)

    def test_single_canonical_playbook_exists(self):
        self.assertTrue(DOC.is_file(), "docs/incident-response.md is missing")

    def test_covers_all_three_tiers(self):
        for tier in ("contract", "backend", "cdn"):
            self.assertIn(tier, self.doc.lower(), f"playbook must cover the {tier} tier")

    def test_walks_the_coordinated_sequence_in_order(self):
        headings = re.findall(r"^### Phase \d+ — (.+)$", self.doc, re.MULTILINE)
        self.assertGreaterEqual(len(headings), 6, "playbook should walk ordered phases")
        # The ordering that matters: contain the contract before the edge/backend.
        contract = self.doc.index("Contain the contract tier")
        edge = self.doc.index("Contain the frontend / edge tier")
        backend = self.doc.index("Contain the backend tier")
        self.assertLess(contract, edge)
        self.assertLess(edge, backend)

    def test_documents_ownership_and_communication(self):
        self.assertIn("Incident Commander", self.doc)
        self.assertRegex(self.doc, r"## Roles and ownership")
        self.assertRegex(self.doc, r"## Communication")
        self.assertIn("Comms lead", self.doc)

    def test_references_the_concrete_containment_actions(self):
        lower = self.doc.lower()
        for token in ("pause", "unpause", "rollback=true", "cache", "health", "blue-green-deploy.sh"):
            self.assertIn(token, lower)

    def test_links_the_specialist_runbooks(self):
        for link in ("blue-green-deployment.md", "cloudwatch-incident-runbook.md", "cdn.md"):
            self.assertIn(link, self.doc)


class TestLiveIncidentChecklist(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(DOC)

    def test_has_checklist_format(self):
        boxes = re.findall(r"^\s*\[[ x]\] ", self.doc, re.MULTILINE)
        self.assertGreaterEqual(len(boxes), 20, "playbook needs a usable live checklist")

    def test_live_checklist_section_exists(self):
        self.assertRegex(self.doc, r"## Live incident checklist")

    def test_severity_levels_defined(self):
        for sev in ("SEV1", "SEV2", "SEV3"):
            self.assertIn(sev, self.doc)


class TestPlaybookIsDiscoverable(unittest.TestCase):
    def test_troubleshooting_links_the_playbook(self):
        doc = _read(TROUBLESHOOTING)
        self.assertIn("incident-response.md", doc)
        self.assertIn("Incident Response", doc)

    def test_security_doc_links_the_playbook(self):
        self.assertIn("incident-response.md", _read(SECURITY))

    def test_blue_green_doc_links_the_playbook(self):
        self.assertIn("incident-response.md", _read(BLUE_GREEN))

    def test_readme_lists_the_playbook(self):
        self.assertIn("docs/incident-response.md", _read(README))


if __name__ == "__main__":
    unittest.main()
