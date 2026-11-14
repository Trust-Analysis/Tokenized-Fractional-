"""Tests for issue #797: a public status page independent of the app.

Acceptance criteria under test:

1. Stand up a basic public status page reflecting the health of the backend, the
   frontend, and (if monitored) the RPC dependency.
2. Link to it from the frontend's footer and from docs/troubleshooting.md.

The page's evaluation logic is dependency-free by design, so its own unit suite
(`node --test status/status.test.mjs`) is executed here as well as inspected.
"""

import json
import re
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STATUS_DIR = REPO_ROOT / "status"
STATUS_JS = STATUS_DIR / "status.js"
STATUS_TEST = STATUS_DIR / "status.test.mjs"
STATUS_README = STATUS_DIR / "README.md"
FOOTER = REPO_ROOT / "frontend" / "src" / "components" / "Footer" / "Footer.jsx"
APP = REPO_ROOT / "frontend" / "src" / "App.jsx"
TROUBLESHOOTING = REPO_ROOT / "docs" / "troubleshooting.md"
LOCALES = REPO_ROOT / "frontend" / "src" / "locales"

TIERS = ["api", "web", "rpc"]


def _read(path):
    return path.read_text(encoding="utf-8")


class TestStatusPageFiles(unittest.TestCase):
    def test_page_and_assets_exist(self):
        for name in ["index.html", "status.js", "app.js", "status.css", "README.md"]:
            self.assertTrue(
                (STATUS_DIR / name).is_file(),
                f"status/{name} is missing",
            )

    def test_page_loads_its_module_and_wires_both_elements(self):
        html = _read(STATUS_DIR / "index.html")
        self.assertRegex(html, r'<script type="module" src="\./app\.js">')
        self.assertIn('id="overall"', html)
        self.assertIn('id="checks"', html)

    def test_page_works_without_the_app(self):
        """It must be deployable on its own — no bundler, no shared assets."""
        html = _read(STATUS_DIR / "index.html")
        # Loaded assets (scripts, stylesheets) must be local to the directory.
        # Anchors to documentation are allowed to be absolute links.
        self.assertRegex(html, r'<link rel="stylesheet" href="\./status\.css" />')
        for src in re.findall(r'src="([^"]+)"', html):
            self.assertTrue(
                src.startswith("./"),
                f"status/index.html loads script {src!r}; the page must only load its own files",
            )

    def test_page_has_a_noscript_fallback(self):
        self.assertIn("<noscript>", _read(STATUS_DIR / "index.html"))

    def test_page_rechecks_periodically(self):
        app = _read(STATUS_DIR / "app.js")
        self.assertRegex(app, r"setInterval\(refresh, REFRESH_INTERVAL_MS\)")
        self.assertRegex(app, r"REFRESH_INTERVAL_MS = \d+_?\d*")


class TestEvaluationLogic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(STATUS_JS)

    def test_exposes_the_full_status_vocabulary(self):
        for name in ["OPERATIONAL", "DEGRADED", "OUTAGE", "UNKNOWN"]:
            self.assertIn(name, self.source, f"STATUS is missing {name}")

    def test_exports_the_probe_and_aggregation_helpers(self):
        for name in [
            "worstStatus",
            "overallSummary",
            "describeBackendHealth",
            "describeRpcHealth",
            "probe",
            "collectStatus",
            "resolveEndpoints",
        ]:
            self.assertRegex(self.source, rf"export (async )?function {name}\b")

    def test_measures_all_three_tiers(self):
        for tier in TIERS:
            self.assertRegex(self.source, rf"probe\('{tier}'")

    def test_defaults_to_the_placeholder_aware_configuration(self):
        self.assertIn("DEFAULT_ENDPOINTS", self.source)
        self.assertIn("STATUS_ENDPOINTS", self.source)

    def test_never_collapses_an_empty_result_set_into_operational(self):
        """'We measured nothing' must not render as 'all good'."""
        self.assertRegex(
            self.source,
            r"statuses\.length === 0\) return STATUS\.UNKNOWN",
            "worstStatus([]) must be UNKNOWN",
        )

    def test_a_network_failure_becomes_a_status_rather_than_an_exception(self):
        self.assertRegex(self.source, r"catch \(error\)")

    def test_rpc_is_probed_with_json_rpc_post(self):
        self.assertIn("getHealth", self.source)
        self.assertRegex(self.source, r"method: 'POST'")

    def test_evaluation_logic_does_not_touch_the_dom(self):
        self.assertNotIn("document.", self.source)
        self.assertNotIn("window.", self.source)


class TestStatusUnitSuite(unittest.TestCase):
    def test_node_test_suite_passes(self):
        proc = subprocess.run(
            ["node", "--test", str(STATUS_TEST)],
            capture_output=True,
            text=True,
            cwd=str(REPO_ROOT),
            timeout=120,
            check=False,
        )
        self.assertEqual(
            proc.returncode,
            0,
            f"status/status.test.mjs failed:\n{proc.stdout}\n{proc.stderr}",
        )
        # Node's default reporter prints "ℹ pass N" / "ℹ fail N"; TAP prints
        # "# pass N". Accept either, but require zero failures either way.
        self.assertRegex(proc.stdout, r"[#ℹ] pass \d+")
        self.assertRegex(proc.stdout, r"[#ℹ] fail 0")

    def test_suite_is_dependency_free(self):
        """It must keep running in CI without an install step."""
        source = _read(STATUS_TEST)
        self.assertIn("node:test", source)
        self.assertIn("node:assert", source)
        self.assertNotIn("vitest", source)


class TestFooterLinksToStatusPage(unittest.TestCase):
    def test_footer_component_exists(self):
        self.assertTrue(FOOTER.is_file(), "frontend/src/components/Footer/Footer.jsx is missing")

    def test_footer_renders_an_external_link_with_a_stable_hook(self):
        source = _read(FOOTER)
        self.assertIn('data-testid="status-page-link"', source)
        self.assertRegex(source, r"target=\"_blank\"")
        self.assertRegex(source, r"rel=\"noreferrer noopener\"")

    def test_footer_url_is_configurable_at_build_time(self):
        source = _read(FOOTER)
        self.assertIn("VITE_STATUS_URL", source)
        self.assertRegex(source, r"DEFAULT_STATUS_URL = 'https://status\.example\.com'")

    def test_footer_text_is_translated(self):
        self.assertIn("t('footer.status')", _read(FOOTER))

    def test_app_renders_the_footer(self):
        app = _read(APP)
        self.assertRegex(app, r"import Footer from '\./components/Footer/Footer'")
        self.assertRegex(app, r"<Footer />")

    def test_render_manifest_configures_the_status_url(self):
        manifest = _read(REPO_ROOT / "render.yaml")
        self.assertIn("VITE_STATUS_URL", manifest)
        self.assertIn("#797", manifest)

    def test_every_locale_defines_the_footer_string(self):
        """The i18n parity test fails on a key present in English only."""
        codes = ["en", "es", "fr", "de"]
        values = {}
        for code in codes:
            payload = json.loads(_read(LOCALES / f"{code}.json"))
            self.assertIn("footer", payload, f"{code}.json has no `footer` namespace")
            self.assertIn("status", payload["footer"], f"{code}.json has no footer.status")
            values[code] = payload["footer"]["status"]

        self.assertEqual(values["en"], "Service status")
        for code in ["es", "fr", "de"]:
            self.assertNotEqual(
                values[code],
                values["en"],
                f"{code}.json still has the English string — translate it",
            )
            self.assertTrue(values[code].strip(), f"{code}.json footer.status is empty")


class TestTroubleshootingLinksToStatusPage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(TROUBLESHOOTING)

    def test_doc_has_a_dedicated_section(self):
        self.assertRegex(self.doc, r"(?i)## Is the Problem Known\? Check the Status Page")

    def test_section_is_in_the_table_of_contents(self):
        toc = self.doc.split("## Table of Contents", 1)[1].split("---", 1)[0]
        self.assertIn("#is-the-problem-known-check-the-status-page", toc)

    def test_doc_links_to_the_status_page_location(self):
        self.assertRegex(self.doc, r"\[`status/`\]\(\.\./status\)")

    def test_doc_names_all_three_tiers(self):
        section = self.doc.split("## Is the Problem Known", 1)[1]
        for tier in ["backend API", "web application", "Stellar RPC"]:
            self.assertIn(tier, section, f"the section does not mention the {tier} tier")

    def test_doc_warns_that_unknown_is_not_healthy(self):
        section = self.doc.split("## Is the Problem Known", 1)[1]
        self.assertRegex(section, r"(?i)unknown[^\n]*not[^\n]*healthy")


class TestDeploymentIsDocumented(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(STATUS_README)

    def test_documents_that_the_page_must_be_hosted_independently(self):
        self.assertRegex(self.doc, r"(?i)independent of the app")

    def test_documents_the_endpoint_override_mechanisms(self):
        self.assertIn("STATUS_ENDPOINTS", self.doc)
        self.assertRegex(self.doc, r"\?api=")

    def test_documents_each_tier_and_its_verdict(self):
        for tier in ["Backend API", "Web application", "Stellar RPC"]:
            self.assertIn(tier, self.doc)

    def test_documents_how_to_run_the_suite(self):
        self.assertIn("node --test status/status.test.mjs", self.doc)


if __name__ == "__main__":
    unittest.main()
