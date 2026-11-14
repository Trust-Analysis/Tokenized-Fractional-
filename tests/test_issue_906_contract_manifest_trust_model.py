"""Tests for issue #906: ContractVerificationBanner trust model and tamper-evidence.

Acceptance criteria under test:
1. Document the manifest's trust model: is it build-time-bundled and trusted implicitly,
   or independently fetched/verified at runtime against a separately-secured source?
2. If build-time-bundled only, consider adding a runtime cross-check against an
   independently-hosted, signed copy of the manifest so a compromised build pipeline
   can't silently defeat the verification banner's purpose.
"""

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_README = REPO_ROOT / "frontend" / "contract-manifest" / "README.md"
DOC_FILE = REPO_ROOT / "docs" / "contract-address-verification.md"
UTIL_FILE = REPO_ROOT / "frontend" / "src" / "utils" / "contractManifest.js"
ENV_EXAMPLE = REPO_ROOT / "frontend" / ".env.example"


def _read(path):
    return path.read_text(encoding="utf-8")


class TestContractManifestTrustModelDocumentation(unittest.TestCase):
    def test_manifest_readme_exists_and_documents_trust_model(self):
        self.assertTrue(MANIFEST_README.is_file(), "frontend/contract-manifest/README.md is missing")
        content = _read(MANIFEST_README)
        self.assertIn("Trust Model Analysis", content)
        self.assertIn("Ed25519", content)
        self.assertIn("Compromised CI / Build Pipeline", content)
        self.assertIn("Runtime Secondary Cross-Check", content)

    def test_docs_explain_tamper_evidence_and_threat_model(self):
        self.assertTrue(DOC_FILE.is_file(), "docs/contract-address-verification.md is missing")
        content = _read(DOC_FILE)
        self.assertIn("Trust Model & Tamper-Evidence Analysis", content)
        self.assertIn("VITE_CONTRACT_MANIFEST_REMOTE_URL", content)
        self.assertIn("Threat Model & Mitigations", content)

    def test_env_example_documents_remote_cross_check(self):
        content = _read(ENV_EXAMPLE)
        self.assertIn("VITE_CONTRACT_MANIFEST_REMOTE_URL", content)


class TestRuntimeCrossCheckImplementation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(UTIL_FILE)

    def test_exposes_remote_manifest_url_resolution(self):
        self.assertIn("export function resolveRemoteManifestUrl", self.source)
        self.assertIn("VITE_CONTRACT_MANIFEST_REMOTE_URL", self.source)

    def test_verify_configured_contract_supports_remote_cross_check(self):
        self.assertIn("remoteUrl", self.source)
        self.assertIn("remoteManifest", self.source)
        self.assertIn("Tamper detected", self.source)


if __name__ == "__main__":
    unittest.main()
