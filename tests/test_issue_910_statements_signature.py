"""Tests for issue #910: Authenticated, digitally-signed account statement PDFs.

Acceptance criteria under test:
1. Add a digital signature to generated statement PDFs, or at minimum publish a
   verifiable hash/checksum alongside each generated statement.
2. Document how a third party (e.g. a user's accountant, or a financial institution)
   can verify a given statement PDF is authentic and unmodified.
3. Resolve this alongside the route's missing-authentication issue, since an
   unauthenticated, unsigned 'official' financial document generator is a compounding risk.
"""

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STATEMENTS_ROUTE = REPO_ROOT / "backend" / "src" / "routes" / "statements.js"
APP_FILE = REPO_ROOT / "backend" / "src" / "app.js"
DOC_FILE = REPO_ROOT / "docs" / "account-statement-verification.md"


def _read(path):
    return path.read_text(encoding="utf-8")


class TestStatementsRouteImplementation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(STATEMENTS_ROUTE)
        cls.app_source = _read(APP_FILE)

    def test_enforces_authentication(self):
        self.assertIn("statementAuthMiddleware", self.source)
        self.assertIn("AUTHENTICATION_REQUIRED", self.source)
        self.assertIn("401", self.source)

    def test_enforces_authorization(self):
        self.assertIn("FORBIDDEN", self.source)
        self.assertIn("403", self.source)

    def test_implements_digital_signature_and_headers(self):
        self.assertIn("signStatementHash", self.source)
        self.assertIn("verifyStatementSignature", self.source)
        self.assertIn("X-Statement-SHA256", self.source)
        self.assertIn("X-Statement-Signature", self.source)
        self.assertIn("X-Statement-Key-Id", self.source)

    def test_provides_verification_endpoint(self):
        self.assertIn("'/verify'", self.source)
        self.assertIn("GENUINE_OFFICIAL_DOCUMENT", self.source)
        self.assertIn("TAMPERED_OR_INVALID", self.source)

    def test_statements_mounted_in_app(self):
        self.assertIn("createStatementRoutes", self.app_source)
        self.assertIn("/api/v1/statements", self.app_source)


class TestStatementsDocumentation(unittest.TestCase):
    def test_documentation_covers_verification_and_auth(self):
        self.assertTrue(DOC_FILE.is_file(), "docs/account-statement-verification.md is missing")
        content = _read(DOC_FILE)
        self.assertIn("Authentication Requirements", content)
        self.assertIn("Digital Signature & Tamper-Evidence", content)
        self.assertIn("Third-Party Verification Workflow", content)
        self.assertIn("/api/v1/statements/verify", content)


if __name__ == "__main__":
    unittest.main()
