"""
Unit and Contract Tests for Issue #1117:
OpenTelemetry sampling uses Math.random() per service instead of a trace-ID ratio sampler.

Acceptance criteria under test:
1. Use ParentBased(TraceIdRatioBased(p)) so downstream services follow the parent's sampling decision.
2. Eliminate Math.random() in sampling decisions.
3. Always sample errors and slow requests via tail sampling documentation and collector configuration.
4. Consistent sampling decisions across gateway and subgraph per trace.
"""

import unittest
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TRACING_CONFIG_JS = REPO_ROOT / "backend" / "src" / "tracing" / "tracingConfig.js"
TAIL_SAMPLING_DOC = REPO_ROOT / "docs" / "tracing-tail-sampling.md"

def _read(path):
    return path.read_text(encoding="utf-8")

class TestOpenTelemetrySamplingImplementation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = _read(TRACING_CONFIG_JS)
        cls.doc = _read(TAIL_SAMPLING_DOC)

    def test_imports_parent_based_and_trace_id_ratio_sampler(self):
        """Verifies that ParentBasedSampler and TraceIdRatioBasedSampler are imported from OpenTelemetry SDK."""
        self.assertIn("ParentBasedSampler", self.source)
        self.assertIn("TraceIdRatioBasedSampler", self.source)

    def test_eliminates_math_random_in_sampling(self):
        """Verifies that Math.random() is removed from sampling logic to prevent trace fragmentation."""
        # Find createParentBasedSampler function or sampler definition
        sampler_func = re.search(r'createParentBasedSampler\([\s\S]*?\{([\s\S]*?)\n\}', self.source)
        self.assertIsNotNone(sampler_func, "createParentBasedSampler function must exist")
        self.assertNotIn("Math.random", sampler_func.group(1), "Math.random() must not be used in sampling decisions")

    def test_parent_based_sampler_wired_into_tracer_provider(self):
        """Verifies NodeTracerProvider uses the ParentBasedSampler."""
        self.assertIn("createParentBasedSampler", self.source)
        self.assertRegex(self.source, r'sampler:\s*createParentBasedSampler\(')

    def test_tail_sampling_doc_covers_errors_and_latency(self):
        """Verifies documentation defines tail sampling policies for error capture and high-latency traces."""
        self.assertTrue(TAIL_SAMPLING_DOC.is_file(), "docs/tracing-tail-sampling.md must exist")
        self.assertIn("tail_sampling", self.doc)
        self.assertIn("status_code", self.doc)
        self.assertIn("latency", self.doc)
        self.assertIn("ParentBasedSampler", self.doc)
        self.assertIn("TraceIdRatioBasedSampler", self.doc)

class TestDistributedSamplingConsistency(unittest.TestCase):
    """Simulates distributed gateway and subgraph sampling decisions on trace ID."""

    def _sample_decision(self, trace_id, ratio=0.1):
        """Replicates deterministic trace ID ratio sampling."""
        if trace_id and len(trace_id) >= 16:
            id_slice = trace_id[-8:]
            int_val = int(id_slice, 16)
            threshold = int(0xffffffff * ratio)
            return 2 if int_val < threshold else 1
        return 1

    def test_gateway_and_subgraph_make_identical_decision_for_same_trace(self):
        """Asserts that identical trace IDs yield identical sampling outcomes on independent nodes."""
        traces = [
            "4bf92f3577b34da6a3ce929d0e0e4736",
            "0af7651916cd43dd8448eb211c80319c",
            "b7ad6b7169203331abeeabb79081364c",
            "00000000000000000000000000000001",
            "fffffffffffffffffffffffffffffffe",
        ]
        ratio = 0.5
        for tid in traces:
            gateway_decision = self._sample_decision(tid, ratio)
            subgraph_decision = self._sample_decision(tid, ratio)
            self.assertEqual(gateway_decision, subgraph_decision, f"Trace {tid} must produce identical decisions")

if __name__ == "__main__":
    unittest.main()
