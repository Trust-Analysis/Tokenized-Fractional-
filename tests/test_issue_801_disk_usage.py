"""Tests for issue #801: disk-usage monitoring and alerting.

Acceptance criteria under test:

1. Add disk-usage monitoring/alerting appropriate to the hosting platform.
2. Document the alert threshold and response procedure.

Unlike the rest of the files in this directory these tests are partly
behavioural: `backend/scripts/check-disk-usage.js` imports nothing but Node
builtins, so it runs here without `npm install`. The exit codes are the
alerting contract a scheduler depends on, so they are exercised directly rather
than only inspected as source.
"""

import json
import re
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
UTIL = REPO_ROOT / "backend" / "src" / "utils" / "diskUsage.js"
CLI = REPO_ROOT / "backend" / "scripts" / "check-disk-usage.js"
INDEX = REPO_ROOT / "backend" / "index.js"
METRICS = REPO_ROOT / "backend" / "src" / "services" / "metricsService.js"
DOC = REPO_ROOT / "docs" / "disk-usage-monitoring.md"
JEST_TEST = REPO_ROOT / "backend" / "__tests__" / "diskUsage.test.js"

# Status -> exit code, from docs/disk-usage-monitoring.md.
EXIT_CODES = {"ok": 0, "warn": 1, "critical": 2, "unknown": 3}


def _read(path):
    return path.read_text(encoding="utf-8")


def _run_cli(*args):
    """Run the CLI and return (returncode, stdout, stderr)."""
    proc = subprocess.run(
        ["node", str(CLI), *args],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT / "backend"),
        timeout=60,
        check=False,
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


class TestProbeModule(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(UTIL)

    def test_probe_module_exists(self):
        self.assertTrue(UTIL.is_file(), "backend/src/utils/diskUsage.js is missing")

    def test_exports_a_single_shared_snapshot(self):
        """Every signal must call the same probe or they will disagree."""
        for name in [
            "readDiskUsage",
            "readDiskUsageSync",
            "resolveThresholds",
            "classifyUsage",
            "resolveDataDirectory",
            "parsePercent",
            "formatBytes",
        ]:
            self.assertRegex(
                self.source,
                rf"export (async )?function {name}\b|export const {name}\b",
                f"diskUsage.js does not export {name}",
            )

    def test_thresholds_and_statuses_are_exported_constants(self):
        for name in [
            "DEFAULT_WARN_PERCENT",
            "DEFAULT_CRITICAL_PERCENT",
            "STATUS_OK",
            "STATUS_WARN",
            "STATUS_CRITICAL",
            "STATUS_UNKNOWN",
        ]:
            self.assertIn(name, self.source, f"diskUsage.js does not define {name}")

    def test_defaults_match_the_documented_thresholds(self):
        self.assertRegex(self.source, r"DEFAULT_WARN_PERCENT = 80")
        self.assertRegex(self.source, r"DEFAULT_CRITICAL_PERCENT = 90")

    def test_a_misconfigured_value_cannot_disable_alerting(self):
        """NaN comparisons are silently false, so bad input must fall back."""
        self.assertIn("Number.isFinite", self.source)
        self.assertRegex(self.source, r"criticalPercent <= warnPercent")

    def test_measures_the_filesystem_and_not_only_the_directory(self):
        self.assertIn("statfs", self.source)

    def test_an_unreadable_mount_is_reported_and_never_thrown(self):
        self.assertIn("STATUS_UNKNOWN", self.source)
        self.assertRegex(self.source, r"catch \(error\)")

    def test_a_zero_sized_volume_is_not_reported_as_healthy(self):
        self.assertRegex(self.source, r"zero-sized volume")


class TestHealthEndpointReportsDisk(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(INDEX)

    def test_health_imports_the_probe(self):
        self.assertRegex(self.source, r"import \{[^}]*readDiskUsage[^}]*\} from '\./src/utils/diskUsage\.js'")

    def test_health_reports_a_disk_dependency(self):
        self.assertRegex(self.source, r"deps\.disk = \{")

    def test_disk_does_not_change_the_http_status(self):
        """A failing health check makes the platform restart; that loses writes.

        The probe must therefore be informational on /health, with alerting
        living in the CLI and the gauge instead.
        """
        self.assertRegex(
            self.source,
            r"does NOT influence the HTTP status",
            "index.js must state that disk pressure is informational on /health",
        )

    def test_disk_is_documented_in_the_endpoint_spec(self):
        self.assertIn("docs/disk-usage-monitoring.md", self.source)


class TestPrometheusGauges(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(METRICS)

    def test_exposes_a_disk_usage_ratio(self):
        self.assertIn("disk_usage_ratio", self.source)

    def test_exposes_available_bytes(self):
        self.assertIn("disk_available_bytes", self.source)

    def test_gauges_share_the_probe_rather_than_reimplementing_it(self):
        self.assertIn("readDiskUsageSync", self.source)
        self.assertIn("resolveDataDirectory", self.source)

    def test_a_measurement_failure_does_not_fail_the_whole_scrape(self):
        for name in ["disk_usage_ratio", "disk_available_bytes"]:
            self.assertIn(name, self.source)
        self.assertIn("catch {", self.source)


class TestCliContract(unittest.TestCase):
    """The exit codes are what a scheduler alerts on."""

    @classmethod
    def setUpClass(cls):
        cls.source = _read(CLI)

    def test_cli_exists_and_documents_its_exit_codes(self):
        self.assertTrue(CLI.is_file())
        self.assertIn("EXIT_CODES", self.source)
        # The one-line contract in --help, and in the module docstring.
        self.assertIn("Exit codes: 0 ok, 1 warn, 2 critical, 3 could not measure.", self.source)
        for code in EXIT_CODES.values():
            # (?m) so ^ anchors to each documented line, not just offset 0.
            self.assertRegex(
                self.source,
                rf"(?m)^\s*\*?\s*{code}\s+\S",
                f"the CLI must document exit code {code}",
            )

    def test_json_output_is_machine_readable_and_coherent(self):
        code, out, _ = _run_cli("--json")
        payload = json.loads(out)

        for key in [
            "path",
            "status",
            "usedPercent",
            "totalBytes",
            "usedBytes",
            "freeBytes",
            "availableBytes",
            "thresholds",
        ]:
            self.assertIn(key, payload, f"--json output is missing {key}")

        self.assertEqual(payload["usedBytes"] + payload["freeBytes"], payload["totalBytes"])
        self.assertIn(payload["status"], EXIT_CODES)
        self.assertEqual(code, EXIT_CODES[payload["status"]])

    def test_thresholds_default_to_the_documented_values(self):
        _, out, _ = _run_cli("--json")
        thresholds = json.loads(out)["thresholds"]
        self.assertEqual(thresholds["warnPercent"], 80)
        self.assertEqual(thresholds["criticalPercent"], 90)

    def test_an_unmeasurable_path_exits_3_and_never_0(self):
        code, _, err = _run_cli("--path", "/definitely/not/a/real/path-801")
        self.assertEqual(code, 3, "an unmeasurable filesystem must never look healthy")
        self.assertIn("unknown", err.lower())

    def test_an_unmeasurable_path_reports_unknown_in_json_too(self):
        code, out, _ = _run_cli("--json", "--path", "/definitely/not/a/real/path-801")
        self.assertEqual(code, 3)
        self.assertEqual(json.loads(out)["status"], "unknown")

    def test_a_malformed_threshold_falls_back_to_the_defaults(self):
        """It must not crash, and it must not silently stop measuring either."""
        code, out, _ = _run_cli("--warn", "not-a-number", "--json")
        payload = json.loads(out)
        self.assertEqual(payload["thresholds"], {"warnPercent": 80, "criticalPercent": 90})
        self.assertEqual(code, EXIT_CODES[payload["status"]])

    def test_an_unknown_flag_exits_3(self):
        code, _, err = _run_cli("--nope")
        self.assertEqual(code, 3)
        self.assertIn("unknown argument", err)

    def test_alerting_goes_to_stderr(self):
        """A scheduler that only captures stderr must still see the alert."""
        code, out, err = _run_cli("--warn", "1", "--critical", "2")
        self.assertIn(code, (1, 2))
        self.assertEqual(out, "")
        self.assertRegex(err, r"disk usage (WARN|CRITICAL)")


class TestThresholdsAndProcedureAreDocumented(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(DOC)

    def test_doc_exists(self):
        self.assertTrue(DOC.is_file())

    def test_documents_both_threshold_variables_and_their_defaults(self):
        self.assertIn("DISK_USAGE_WARN_PERCENT", self.doc)
        self.assertIn("DISK_USAGE_CRITICAL_PERCENT", self.doc)
        self.assertIn("DISK_USAGE_PATH", self.doc)
        for default in ["`80`", "`90`"]:
            self.assertIn(default, self.doc)

    def test_documents_every_exit_code(self):
        for code in EXIT_CODES.values():
            self.assertRegex(self.doc, rf"\|\s*`{code}`\s*\|")

    def test_documents_a_response_procedure(self):
        self.assertRegex(self.doc, r"(?i)## Response procedure")
        self.assertRegex(self.doc, r"(?i)on `warn`")
        self.assertRegex(self.doc, r"(?i)on `critical`")

    def test_response_procedure_has_ordered_actionable_steps(self):
        procedure = self.doc.split("## Response procedure", 1)[1]
        numbered = [line for line in procedure.splitlines() if line.strip()[:2].rstrip(".").isdigit()]
        self.assertGreaterEqual(len(numbered), 6, "the runbook should have concrete steps")

    def test_documents_wiring_the_alert_to_the_host(self):
        for option in ["Render", "uptime", "Prometheus"]:
            self.assertIn(option, self.doc)

    def test_referenced_from_contributing(self):
        self.assertIn("docs/disk-usage-monitoring.md", _read(REPO_ROOT / "CONTRIBUTING.md"))

    def test_jest_suite_exists_for_the_probe(self):
        self.assertTrue(JEST_TEST.is_file())


class TestSyntax(unittest.TestCase):
    def test_new_javascript_parses(self):
        for path in [UTIL, CLI, METRICS, INDEX, JEST_TEST]:
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
