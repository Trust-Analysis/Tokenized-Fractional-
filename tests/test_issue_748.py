"""Regression tests for issue #748: Soroban Fuzz Tests (proptest) CI job.

The bug: .github/workflows/pr.yml ran
    cargo test --lib property_tests::fuzz_ -- --test-threads=1
but no test path contains the substring ``property_tests::fuzz_`` -- the
``property_tests`` module's cases are named ``test_*`` and the ``fuzz_*``
cases live in the modules ``fuzz_fractional_math``,
``fuzz_order_book_transitions`` and ``fuzz_dividend_distribution``.
``cargo test`` exits 0 when a filter matches zero tests, so the job passed
silently while running nothing.

These tests statically validate the workflow against the real test modules
in contracts/src/lib.rs. On the pre-fix workflow every test here fails.
"""

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "pr.yml"
LIB_RS = REPO_ROOT / "contracts" / "src" / "lib.rs"

# Modules that actually contain the fuzz tests (contracts/src/lib.rs).
FUZZ_MODULES = [
    "fuzz_fractional_math",
    "fuzz_order_book_transitions",
    "fuzz_dividend_distribution",
]


def _read(path):
    return path.read_text(encoding="utf-8")


def _fuzz_step_body(workflow_text):
    """Return the body of the 'Run fuzz tests (proptest)' step."""
    match = re.search(
        r"- name: Run fuzz tests \(proptest\)(.*?)(?=\n      - name:|\Z)",
        workflow_text,
        re.DOTALL,
    )
    assert match, "workflow has no 'Run fuzz tests (proptest)' step"
    return match.group(1)


def _cargo_filter(step_body):
    """Extract the <FILTER> from the step's `cargo test --lib <FILTER>` run command."""
    match = re.search(r"cargo test --lib (\S+)", step_body)
    assert match, "fuzz step has no 'cargo test --lib <FILTER>' command"
    return match.group(1)


def _rust_test_paths(lib_rs_text):
    """Return candidate cargo test paths as {module: [test_fn, ...]}.

    Top-level `mod name {` blocks in lib.rs are scanned for `fn fuzz_*` /
    `fn test_*` definitions, mirroring the `module::test_fn` paths cargo
    substring-matches filters against.
    """
    modules = {}
    current = None
    for line in lib_rs_text.splitlines():
        mod_match = re.match(r"mod (\w+) \{", line)
        if mod_match:
            current = mod_match.group(1)
            modules.setdefault(current, [])
            continue
        fn_match = re.match(r"\s*fn ((?:fuzz|test)_\w+)\(", line)
        if fn_match and current is not None:
            modules[current].append(fn_match.group(1))
    return modules


class TestFuzzFilterMatchesRealTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = _read(WORKFLOW)
        cls.step = _fuzz_step_body(cls.workflow)
        cls.filter = _cargo_filter(cls.step)
        cls.modules = _rust_test_paths(_read(LIB_RS))

    def _matched(self, filter_str):
        """cargo test semantics: substring match against `module::test_fn` paths."""
        return [
            f"{mod}::{fn}"
            for mod, fns in self.modules.items()
            for fn in fns
            if filter_str in f"{mod}::{fn}"
        ]

    def test_workflow_filter_matches_nonzero_tests(self):
        """Acceptance: the job runs the real fuzz tests (non-zero count)."""
        matched = self._matched(self.filter)
        self.assertGreater(
            len(matched),
            0,
            f"workflow filter {self.filter!r} matches zero tests in contracts/src/lib.rs",
        )

    def test_workflow_filter_covers_every_fuzz_module(self):
        """The filter must name the modules that actually contain the fuzz tests."""
        matched = self._matched(self.filter)
        for mod in FUZZ_MODULES:
            self.assertTrue(
                any(m.startswith(f"{mod}::") for m in matched),
                f"filter {self.filter!r} matches no tests in module {mod!r}",
            )

    def test_old_filter_reproduces_the_bug(self):
        """Characterization: the pre-fix filter matched zero tests (silent pass)."""
        self.assertEqual(
            self._matched("property_tests::fuzz_"),
            [],
            "the original filter unexpectedly matches tests now; update this characterization",
        )

    def test_fuzz_modules_actually_exist(self):
        """Sanity: the modules this issue is about still exist in lib.rs."""
        for mod in FUZZ_MODULES:
            self.assertIn(mod, self.modules, f"{mod} missing from contracts/src/lib.rs")
            self.assertTrue(
                all(fn.startswith("fuzz_") for fn in self.modules[mod]),
                f"{mod} contains non-fuzz test names: {self.modules[mod]}",
            )


class TestZeroMatchGuard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.step = _fuzz_step_body(_read(WORKFLOW))

    def test_guard_lists_matches_before_running(self):
        """Acceptance: a guard inspects what the filter matches (`-- --list`)."""
        self.assertIn("-- --list", self.step, "guard must list tests matched by the filter")

    def test_guard_fails_build_on_zero_matches(self):
        """Acceptance: the build fails if the filter matches zero tests."""
        self.assertRegex(
            self.step,
            r"-eq 0[\s\S]*?exit 1",
            "guard must exit non-zero when the filter matches zero tests",
        )


class TestProptestCasesMechanism(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.step = _fuzz_step_body(_read(WORKFLOW))

    def test_proptest_cases_set_via_env_var(self):
        """Acceptance: PROPTEST_CASES is set through a mechanism proptest reads
        (the PROPTEST_CASES environment variable)."""
        self.assertRegex(
            self.step,
            r"env:[\s\S]*?PROPTEST_CASES:",
            "PROPTEST_CASES must be set as an environment variable on the fuzz step",
        )


class TestWorkflowDocumentsFuzzModules(unittest.TestCase):
    def test_comment_records_fuzz_module_location(self):
        """Acceptance: a comment records which module holds the fuzz tests."""
        workflow = _read(WORKFLOW)
        comments = "\n".join(
            line for line in workflow.splitlines() if line.lstrip().startswith("#")
        )
        self.assertIn("contracts/src/lib.rs", comments)
        for mod in FUZZ_MODULES:
            self.assertIn(
                mod, comments, f"workflow comments must name module {mod!r}"
            )


if __name__ == "__main__":
    unittest.main()
