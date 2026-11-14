"""Tests for issue #794: visual regression testing for the purchase flow.

Acceptance criteria under test:

1. Screenshot-based visual regression tests for the key purchase-flow screens
   (asset detail, confirmation, success/failure states).
2. Wired into CI so PRs touching frontend styling flag visual diffs for review.

These are structural tests: they assert the suite exists, covers the named
screens, is configured to be deterministic, and is actually run by CI. They do
not execute Playwright (that needs a browser and a build).
"""

import json
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND = REPO_ROOT / "frontend"
SPEC = FRONTEND / "e2e" / "visual" / "purchase-flow.visual.spec.js"
CONFIG = FRONTEND / "playwright.visual.config.js"
SPEC_README = FRONTEND / "e2e" / "visual" / "README.md"
PACKAGE = FRONTEND / "package.json"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "visual-regression.yml"
SOROBAN = FRONTEND / "src" / "hooks" / "useSoroban.js"


def _read(path):
    return path.read_text(encoding="utf-8")


class TestVisualSpec(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = _read(SPEC)

    def test_spec_exists(self):
        self.assertTrue(SPEC.is_file(), "the visual spec is missing")

    def test_uses_screenshot_assertions(self):
        self.assertIn("toHaveScreenshot", self.spec)

    def test_covers_the_named_purchase_flow_screens(self):
        for screen in [
            "asset-detail",
            "purchase-panel",
            "confirmation",
            "success",
            "failure",
        ]:
            self.assertIn(screen, self.spec, f"no visual coverage for the {screen} screen")

    def test_failure_state_is_deterministic(self):
        """A failure state that depends on a live network cannot be a baseline."""
        self.assertIn("mock_tx_failure", self.spec)
        self.assertIn("mock_tx_failure", _read(SOROBAN))

    def test_masks_dynamic_content(self):
        self.assertIn("mask:", self.spec)

    def test_drives_the_real_purchase_flow(self):
        for step in ["connect freighter", "buy shares", "confirm"]:
            self.assertRegex(
                self.spec,
                rf"(?i){step}",
                f"the spec should exercise the {step!r} step",
            )


class TestVisualConfig(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = _read(CONFIG)

    def test_config_exists(self):
        self.assertTrue(CONFIG.is_file(), "playwright.visual.config.js is missing")

    def test_scopes_to_the_visual_directory(self):
        self.assertRegex(self.config, r"testDir:\s*'\./e2e/visual'")

    def test_pins_rendering_so_screenshots_are_reproducible(self):
        for setting in [
            "animations: 'disabled'",
            "maxDiffPixelRatio",
            "deviceScaleFactor",
            "colorScheme",
        ]:
            self.assertIn(
                setting,
                self.config,
                f"the visual config must pin {setting} or diffs will be flaky",
            )

    def test_does_not_retry_away_a_diff(self):
        self.assertRegex(self.config, r"retries:\s*0")

    def test_serves_a_production_build_with_the_mock_wallet(self):
        self.assertIn("VITE_MOCK_WALLET", self.config)
        self.assertIn("webServer", self.config)

    def test_snapshots_are_committed_next_to_the_spec(self):
        self.assertIn("__screenshots__", self.config)


class TestScriptsAndDocs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = json.loads(_read(PACKAGE))

    def test_exposes_run_and_update_scripts(self):
        scripts = self.pkg["scripts"]
        self.assertIn("test:visual", scripts)
        self.assertIn("test:visual:update", scripts)
        self.assertIn("playwright.visual.config.js", scripts["test:visual"])
        self.assertIn("--update-snapshots", scripts["test:visual:update"])

    def test_documents_how_to_update_baselines(self):
        doc = _read(SPEC_README)
        self.assertIn("test:visual:update", doc)
        self.assertRegex(doc.lower(), r"review every diff|review the (images|diff)")


class TestCiWiring(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.wf = _read(WORKFLOW)

    def test_workflow_exists(self):
        self.assertTrue(WORKFLOW.is_file(), "visual-regression.yml is missing")

    def test_runs_on_frontend_changes(self):
        self.assertRegex(self.wf, r"pull_request:")
        self.assertRegex(self.wf, r"'frontend/\*\*'")

    def test_runs_the_visual_suite(self):
        self.assertIn("npm run test:visual", self.wf)

    def test_uploads_the_diff_for_review(self):
        self.assertIn("upload-artifact", self.wf)
        self.assertRegex(self.wf, r"-actual\.png|-diff\.png")

    def test_is_not_a_required_check_name_collision(self):
        """Required checks are listed in the branch-protection policy; this one is path-filtered."""
        policy = REPO_ROOT / ".github" / "branch-protection.json"
        if policy.is_file():
            required = json.loads(_read(policy))["required_status_checks"]["contexts"]
            self.assertNotIn("Playwright Visual Regression", required)


class TestSyntax(unittest.TestCase):
    def test_javascript_parses(self):
        for path in [SPEC, CONFIG, SOROBAN]:
            proc = subprocess.run(
                ["node", "--check", str(path)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(
                proc.returncode,
                0,
                f"node --check failed for {path}:\n{proc.stderr}",
            )


if __name__ == "__main__":
    unittest.main()
