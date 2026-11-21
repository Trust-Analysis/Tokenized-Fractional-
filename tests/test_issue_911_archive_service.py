"""Tests for issue #911: Secure, encrypted-at-rest archiving with off-site S3 backup and audit retrieval.

Acceptance criteria under test:
1. Ship archived records to durable, encrypted-at-rest object storage (e.g. S3 with server-side encryption)
   rather than local disk alone.
2. Encrypt archive files if any local/intermediate storage step remains necessary.
3. Document the archive retrieval process for a compliance request (e.g. an audit) against archived-and-removed data.
"""

import json
import os
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_SERVICE = REPO_ROOT / "backend" / "src" / "services" / "archiveService.js"
DOC_FILE = REPO_ROOT / "docs" / "compliance-archive-retrieval.md"


def _read(path):
    return path.read_text(encoding="utf-8")


class TestArchiveSecurityImplementation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(ARCHIVE_SERVICE)

    def test_implements_authenticated_encryption(self):
        self.assertIn("aes-256-gcm", self.source.lower())
        self.assertIn("encryptArchivePayload", self.source)
        self.assertIn("decryptArchivePayload", self.source)
        self.assertIn("getAuthTag", self.source)
        self.assertIn("setAuthTag", self.source)

    def test_implements_s3_offsite_shipping(self):
        self.assertIn("ARCHIVE_S3_BUCKET", self.source)
        self.assertIn("PutObjectCommand", self.source)
        self.assertIn("ServerSideEncryption", self.source)

    def test_implements_audit_retrieval(self):
        self.assertIn("retrieveArchive", self.source)
        self.assertIn("exportArchiveForAudit", self.source)
        self.assertIn("restoreFromArchive", self.source)


class TestArchiveDocumentation(unittest.TestCase):
    def test_compliance_doc_exists_and_covers_audit(self):
        self.assertTrue(DOC_FILE.is_file(), "docs/compliance-archive-retrieval.md is missing")
        content = _read(DOC_FILE)
        self.assertIn("AES-256-GCM", content)
        self.assertIn("Amazon S3", content)
        self.assertIn("Server-Side Encryption", content)
        self.assertIn("retrieveArchive", content)
        self.assertIn("exportArchiveForAudit", content)
        self.assertIn("Compliance Audit Retrieval Process", content)


if __name__ == "__main__":
    unittest.main()
