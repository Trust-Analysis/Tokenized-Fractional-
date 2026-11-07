"""Tests for issue #793: persistence of user display/notification preferences.

Acceptance criteria under test:

1. Basic display preferences (e.g. currency display format) are persisted in
   `localStorage`.
2. A simple preferences/settings panel lets users adjust and save them.

The sanitisation logic is exercised by importing the real ES module in Node.
"""

import shutil
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND = REPO_ROOT / "frontend"
UTIL = FRONTEND / "src" / "utils" / "preferences.js"
STORE = FRONTEND / "src" / "store" / "usePreferencesStore.js"
PANEL = FRONTEND / "src" / "components" / "PreferencesPanel" / "PreferencesPanel.jsx"
APP = FRONTEND / "src" / "App.jsx"


def _read(path):
    return path.read_text(encoding="utf-8")


class TestPreferencesHelpers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(UTIL)

    def test_defines_a_storage_key_and_defaults(self):
        self.assertIn("PREFERENCES_STORAGE_KEY", self.source)
        self.assertIn("DEFAULT_PREFERENCES", self.source)
        self.assertIn("displayCurrency", self.source)

    def test_offers_multiple_currency_formats(self):
        self.assertIn("SUPPORTED_CURRENCIES", self.source)
        self.assertIn("EUR", self.source)

    @unittest.skipUnless(shutil.which("node"), "node is required for the behavioural check")
    def test_unknown_currency_falls_back_to_default(self):
        script = (
            "import { normalizeCurrency } from "
            f"'{UTIL.as_uri()}';"
            "process.stdout.write(normalizeCurrency('not-real'));"
        )
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(result.stdout.strip(), "USD")

    @unittest.skipUnless(shutil.which("node"), "node is required for the behavioural check")
    def test_merge_preferences_drops_unknown_keys(self):
        script = (
            "import { mergePreferences } from "
            f"'{UTIL.as_uri()}';"
            "const merged = mergePreferences({ displayCurrency: 'eur', bogus: 1 });"
            "process.stdout.write(JSON.stringify(merged));"
        )
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        import json

        merged = json.loads(result.stdout)
        self.assertEqual(merged["displayCurrency"], "EUR")
        self.assertNotIn("bogus", merged)


class TestPersistedStore(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(STORE)

    def test_uses_the_persist_middleware(self):
        self.assertIn("persist", self.source)
        self.assertIn("createJSONStorage", self.source)

    def test_persists_to_localstorage_under_the_shared_key(self):
        self.assertIn("localStorage", self.source)
        self.assertIn("PREFERENCES_STORAGE_KEY", self.source)

    def test_exposes_save_and_reset_actions(self):
        self.assertIn("savePreferences", self.source)
        self.assertIn("resetPreferences", self.source)


class TestPreferencesPanel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(PANEL)

    def test_panel_renders_a_settings_dialog(self):
        self.assertIn('role="dialog"', self.source)
        self.assertIn('data-testid="preferences-panel"', self.source)

    def test_panel_has_a_currency_control_and_a_save_action(self):
        self.assertIn("displayCurrency", self.source)
        self.assertIn("Save", self.source)

    def test_app_renders_the_panel(self):
        app = _read(APP)
        self.assertIn("PreferencesPanel", app)
        self.assertRegex(app, r"<PreferencesPanel\b")


if __name__ == "__main__":
    unittest.main()
