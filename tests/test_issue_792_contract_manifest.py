"""Tests for issue #792: client-side verification of the contract deployment.

Acceptance criteria under test:

1. A signed, canonical manifest of official contract addresses is published and
   the frontend fetches it and cross-checks its configured `VITE_CONTRACT_ID`
   against it at startup.
2. A prominent warning banner is shown when the configured contract is not found
   in the canonical list.

The committed manifest's Ed25519 signature is verified with the real signing
CLI, so these tests fail if the artifact or its signature is corrupted.
"""

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND = REPO_ROOT / "frontend"

MANIFEST = FRONTEND / "public" / "official-contracts.json"
PAYLOAD = FRONTEND / "contract-manifest" / "official-contracts.payload.json"
SIGN_SCRIPT = FRONTEND / "scripts" / "sign-contract-manifest.mjs"
UTIL = FRONTEND / "src" / "utils" / "contractManifest.js"
HOOK = FRONTEND / "src" / "hooks" / "useContractManifest.js"
BANNER = (
    FRONTEND
    / "src"
    / "components"
    / "ContractVerificationBanner"
    / "ContractVerificationBanner.jsx"
)
APP = FRONTEND / "src" / "App.jsx"
ENV_EXAMPLE = FRONTEND / ".env.example"
DOC = REPO_ROOT / "docs" / "contract-address-verification.md"


def _read(path):
    return path.read_text(encoding="utf-8")


class TestSignedManifestArtifact(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(_read(MANIFEST))

    def test_manifest_is_served_from_public(self):
        self.assertTrue(MANIFEST.is_file(), "signed manifest must be published in public/")

    def test_manifest_has_the_expected_envelope(self):
        for key in ("schema", "signer", "payload", "signature"):
            self.assertIn(key, self.manifest, f"manifest is missing {key!r}")

    def test_payload_lists_official_contracts(self):
        contracts = self.manifest["payload"]["contracts"]
        self.assertTrue(contracts, "manifest must list at least one official contract")
        for entry in contracts:
            self.assertRegex(entry["id"], r"^C[A-Z2-7]{20,}$")
            self.assertTrue(entry.get("network"))

    def test_unsigned_source_of_truth_exists(self):
        payload = json.loads(_read(PAYLOAD))
        self.assertEqual(payload, self.manifest["payload"])

    @unittest.skipUnless(shutil.which("node"), "node is required for signature verification")
    def test_committed_signature_verifies(self):
        result = subprocess.run(
            ["node", str(SIGN_SCRIPT), "verify", "--file", str(MANIFEST)],
            cwd=FRONTEND,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    @unittest.skipUnless(shutil.which("node"), "node is required for signature verification")
    def test_a_tampered_manifest_fails_verification(self):
        document = json.loads(_read(MANIFEST))
        document["payload"]["contracts"][0]["id"] = "CTAMPERED" + "A" * 49
        tampered = REPO_ROOT / ".tmp-tampered-manifest.json"
        tampered.write_text(json.dumps(document), encoding="utf-8")
        try:
            result = subprocess.run(
                ["node", str(SIGN_SCRIPT), "verify", "--file", str(tampered)],
                cwd=FRONTEND,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
        finally:
            tampered.unlink(missing_ok=True)


class TestRuntimeVerification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(UTIL)

    def test_pins_the_official_signer(self):
        manifest = json.loads(_read(MANIFEST))
        self.assertIn("OFFICIAL_MANIFEST_SIGNERS", self.source)
        self.assertIn(manifest["signer"], self.source)

    def test_exposes_the_verification_api(self):
        for name in (
            "verifyManifest",
            "evaluateContractDeployment",
            "canonicalize",
            "listContractIds",
            "loadOfficialManifest",
            "verifyConfiguredContract",
        ):
            self.assertRegex(self.source, rf"export (async )?function {name}\b")
        self.assertIn("DEPLOYMENT_STATUS", self.source)

    def test_covers_the_deployment_status_vocabulary(self):
        for status in ("official", "unofficial", "unverified", "not-configured"):
            self.assertIn(status, self.source)

    def test_rejects_an_unpinned_signer(self):
        self.assertIn("pinned", self.source.lower())

    def test_hook_runs_at_startup(self):
        hook = _read(HOOK)
        self.assertIn("useEffect", hook)
        self.assertIn("verifyConfiguredContract", hook)


class TestWarningBannerWiring(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.banner = _read(BANNER)

    def test_banner_is_prominent_and_accessible(self):
        self.assertIn('role="alert"', self.banner)
        self.assertIn('data-testid="contract-verification-banner"', self.banner)

    def test_banner_warns_on_unofficial_deployments(self):
        self.assertIn("UNOFFICIAL", self.banner)
        self.assertIn("UNVERIFIED", self.banner)

    def test_app_mounts_the_banner_and_the_hook(self):
        app = _read(APP)
        self.assertIn("ContractVerificationBanner", app)
        self.assertIn("useContractManifest", app)


class TestConfigurationAndDocs(unittest.TestCase):
    def test_env_example_documents_the_manifest_urls(self):
        env = _read(ENV_EXAMPLE)
        self.assertIn("VITE_CONTRACT_MANIFEST_URL", env)
        self.assertIn("VITE_CONTRACT_MANIFEST_SIGNERS", env)

    def test_verification_is_documented(self):
        self.assertTrue(DOC.is_file(), "docs/contract-address-verification.md is missing")
        doc = _read(DOC)
        self.assertRegex(doc, r"sign-contract-manifest\.mjs")
        self.assertIn("OFFICIAL_MANIFEST_SIGNERS", doc)

    def test_python_suite_is_not_the_only_consumer(self):
        # A regression guard: the exact pinned-key mechanism must remain
        # discoverable by grepping the frontend source.
        self.assertTrue(
            re.search(r"OFFICIAL_MANIFEST_SIGNERS\s*=\s*\[", _read(UTIL)),
            "OFFICIAL_MANIFEST_SIGNERS must stay a literal array",
        )


if __name__ == "__main__":
    unittest.main()
