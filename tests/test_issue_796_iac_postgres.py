"""Tests for issue #796: IaC for infrastructure beyond render.yaml.

Acceptance criteria under test:

1. Inventory all infrastructure components not covered by `render.yaml`.
2. Introduce IaC (Terraform) for at least the highest-risk of them.
3. Document the manual-vs-IaC boundary clearly until full coverage is achieved.

The database was chosen as the first component because it is the only one whose
loss is not recoverable by a redeploy. These tests treat the HCL as data: they
assert the provider, the resource and the safety properties (no committed
credentials, sensitive outputs, pinned version) rather than running Terraform.
"""

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODULE = REPO_ROOT / "terraform" / "postgres"
MAIN = MODULE / "main.tf"
VARIABLES = MODULE / "variables.tf"
OUTPUTS = MODULE / "outputs.tf"
TFVARS = MODULE / "terraform.tfvars.example"
MODULE_README = MODULE / "README.md"
DOC = REPO_ROOT / "docs" / "infrastructure.md"
README = REPO_ROOT / "README.md"
RENDER = REPO_ROOT / "render.yaml"


def _read(path):
    return path.read_text(encoding="utf-8")


class TestTerraformModule(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = _read(MAIN)
        cls.variables = _read(VARIABLES)
        cls.outputs = _read(OUTPUTS)

    def test_module_files_exist(self):
        for path in (MAIN, VARIABLES, OUTPUTS, TFVARS, MODULE_README):
            self.assertTrue(path.is_file(), f"{path.relative_to(REPO_ROOT)} is missing")

    def test_uses_the_official_render_provider(self):
        self.assertIn("render-oss/render", self.main)
        self.assertRegex(self.main, r"source\s*=\s*\"render-oss/render\"")

    def test_provider_version_is_pinned(self):
        self.assertRegex(
            self.main,
            r"version\s*=\s*\"~>\s*\d",
            "pin the provider so an apply cannot pull a new major version",
        )

    def test_provisions_a_postgres_database(self):
        self.assertRegex(self.main, r'resource\s+"render_postgres"')

    def test_does_not_commit_credentials(self):
        """A literal API key in the repo is the one mistake that cannot be undone."""
        for text in (self.main, self.variables, _read(TFVARS)):
            self.assertNotRegex(
                text,
                r"api_key\s*=\s*\"[^\"]+\"",
                "credentials must come from the environment, not the configuration",
            )
            self.assertNotRegex(text, r"rnd_[A-Za-z0-9]{8,}", "looks like a Render API key")

    def test_credentials_are_documented_as_environment_variables(self):
        self.assertIn("RENDER_API_KEY", self.main + _read(MODULE_README))
        self.assertIn("RENDER_OWNER_ID", self.main + _read(MODULE_README))

    def test_high_risk_options_are_exposed_as_variables(self):
        for name in ["plan", "region", "postgres_version", "high_availability"]:
            self.assertRegex(self.variables, rf'variable\s+"{name}"')

    def test_defaults_are_safe_for_development_not_production_silence(self):
        """The plan default must be explicitly the cheap one so prod overrides it."""
        self.assertRegex(self.variables, r'variable\s+"plan"[\s\S]*?default\s*=\s*"basic')

    def test_connection_details_are_marked_sensitive(self):
        self.assertRegex(self.outputs, r'output\s+"connection_info"')
        self.assertRegex(
            self.outputs,
            r'output\s+"connection_info"[\s\S]*?sensitive\s*=\s*true',
            "connection strings must not leak into plan output or CI logs",
        )

    def test_exposes_the_id_for_importing_an_existing_instance(self):
        self.assertRegex(self.outputs, r'output\s+"postgres_id"')
        self.assertIn("import", _read(MODULE_README).lower())


class TestInfrastructureInventory(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = _read(DOC)
        cls.flat = " ".join(cls.doc.lower().split())

    def test_doc_exists(self):
        self.assertTrue(DOC.is_file(), "docs/infrastructure.md is missing")

    def test_inventories_the_uncovered_components(self):
        for component in ["elk", "redis", "prometheus", "grafana", "nginx", "kubernetes"]:
            self.assertIn(
                component,
                self.doc.lower(),
                f"the inventory must name {component}",
            )

    def test_marks_the_codified_components(self):
        self.assertIn("render.yaml", self.doc)
        self.assertIn("terraform", self.doc)
        self.assertRegex(self.doc, r"(?i)\bIaC\b")

    def test_draws_the_manual_vs_iac_line(self):
        self.assertRegex(self.flat, r"manual")
        self.assertRegex(
            self.flat,
            r"boundary|manual-vs-iac|manual vs\.? iac",
            "the doc must state where the boundary is, not only what is covered",
        )

    def test_says_the_database_is_now_codified(self):
        self.assertIn("terraform/postgres", self.doc)
        self.assertRegex(self.flat, r"postgres")

    def test_warns_about_local_state_and_secrets(self):
        self.assertRegex(self.flat, r"remote backend")
        self.assertIn("terraform.tfstate", self.doc)
        self.assertRegex(self.flat, r"do not commit")

    def test_lists_the_remaining_gaps_in_priority_order(self):
        self.assertRegex(self.flat, r"remaining gaps")


class TestRepositoryWiring(unittest.TestCase):
    def test_readme_links_the_inventory(self):
        self.assertIn("docs/infrastructure.md", _read(README))

    def test_render_yaml_still_does_not_define_the_database(self):
        """The premise of the issue: the database is not in the Render Blueprint."""
        self.assertNotIn("databases:", _read(RENDER))


if __name__ == "__main__":
    unittest.main()
