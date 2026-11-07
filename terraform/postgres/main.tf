terraform {
  required_version = ">= 1.5.0"

  required_providers {
    render = {
      source  = "render-oss/render"
      version = "~> 1.9"
    }
  }
}

# The provider reads RENDER_API_KEY and RENDER_OWNER_ID from the environment.
# Neither is ever written into this configuration, so the state and the repo
# stay free of credentials. See README.md.
provider "render" {}

# The PostgreSQL database backing the backend API.
#
# Issue #796: this database was previously provisioned by hand and referenced
# only through DATABASE_URL, so nothing in the repository described its plan,
# region, version or retention. Managing it here makes those choices reviewable.
resource "render_postgres" "primary" {
  name    = "${var.name_prefix}-postgres"
  plan    = var.plan
  region  = var.region
  version = var.postgres_version

  database_name = var.database_name
  database_user = var.database_user

  high_availability_enabled = var.high_availability

  # Left unset unless a non-zero value is supplied; Render then picks the
  # plan's default disk size.
  disk_size_gb = var.disk_size_gb > 0 ? var.disk_size_gb : null

  parameter_overrides = var.parameter_overrides

  # An empty list keeps the instance reachable only over Render's private
  # network. Add entries only for hosts that genuinely need public access.
  ip_allow_list = var.ip_allow_list
}
