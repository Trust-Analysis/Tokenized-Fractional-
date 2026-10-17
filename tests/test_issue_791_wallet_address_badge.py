"""Tests for issue #791: a visible connected-wallet address affordance.

Acceptance criteria under test:

1. A persistent header element shows the truncated connected address with a
   copy-to-clipboard button.
2. A "Disconnect" action is available alongside it.

The truncation behaviour is also exercised by importing the real ES module in
Node, so these tests fail if the display logic regresses rather than merely if a
file disappears.
"""

import shutil
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND = REPO_ROOT / "frontend"
UTIL = FRONTEND / "src" / "utils" / "walletAddress.js"
BADGE = FRONTEND / "src" / "components" / "WalletAddressBadge" / "WalletAddressBadge.jsx"
HEADER = FRONTEND / "src" / "components" / "Header" / "Header.jsx"
APP = FRONTEND / "src" / "App.jsx"

FULL_KEY = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234"


def _read(path):
    return path.read_text(encoding="utf-8")


class TestWalletAddressHelpers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(UTIL)

    def test_exports_truncate_and_copy_helpers(self):
        self.assertRegex(self.source, r"export function truncateAddress\b")
        self.assertRegex(self.source, r"export async function copyTextToClipboard\b")

    def test_uses_the_clipboard_api(self):
        self.assertIn("clipboard", self.source)
        self.assertIn("writeText", self.source)

    @unittest.skipUnless(shutil.which("node"), "node is required for the behavioural check")
    def test_truncation_keeps_head_and_tail(self):
        script = (
            "import { truncateAddress } from "
            f"'{UTIL.as_uri()}';"
            f"process.stdout.write(truncateAddress('{FULL_KEY}', 6, 6));"
        )
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        expected = f"{FULL_KEY[:6]}…{FULL_KEY[-6:]}"
        self.assertEqual(result.stdout.strip(), expected)

    @unittest.skipUnless(shutil.which("node"), "node is required for the behavioural check")
    def test_short_addresses_are_returned_unchanged(self):
        script = (
            "import { truncateAddress } from "
            f"'{UTIL.as_uri()}';"
            "process.stdout.write(truncateAddress('GABC'));"
        )
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(result.stdout.strip(), "GABC")


class TestWalletAddressBadgeComponent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(BADGE)

    def test_renders_a_persistent_badge(self):
        self.assertIn('data-testid="wallet-address-badge"', self.source)

    def test_shows_the_truncated_address(self):
        self.assertIn("truncateAddress", self.source)

    def test_has_a_copy_control(self):
        self.assertIn('data-testid="wallet-address-copy"', self.source)

    def test_has_a_disconnect_action(self):
        self.assertRegex(self.source, r"onDisconnect")
        self.assertIn("Disconnect", self.source)

    def test_handles_a_copy_confirmation_state(self):
        self.assertIn("copied", self.source)


class TestWalletBadgeIsWiredIntoTheHeader(unittest.TestCase):
    def test_app_header_uses_the_badge(self):
        app = _read(APP)
        self.assertIn("WalletAddressBadge", app)
        # The raw, untruncated key must no longer be rendered inline.
        self.assertNotIn("{publicKey.slice(0, 8)}", app)

    def test_header_component_uses_the_badge(self):
        self.assertIn("WalletAddressBadge", _read(HEADER))


if __name__ == "__main__":
    unittest.main()
