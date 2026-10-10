variable "name_prefix" {
  type        = string
  description = "Prefix for the Render resource name. Keep it aligned with render.yaml so the database is easy to find."
  default     = "rwa-marketplace"
}

variable "plan" {
  type        = string
  description = "Render Postgres plan. `basic_256mb` is suitable for development/staging; production should use a `pro_*` (e.g. `pro_4gb`) or `pro` plan."
  default     = "basic_256mb"
}

variable "region" {
  type        = string
  description = "Render region. Must match the region of the backend services in render.yaml, or they cannot reach the database over the private network."
  default     = "oregon"
}

variable "postgres_version" {
  type        = string
  description = "PostgreSQL major version. Pin it so an apply cannot silently change the running version."
  default     = "16"
}

variable "database_name" {
  type        = string
  description = "Name of the logical database."
  default     = "rwa_marketplace"
}

variable "database_user" {
  type        = string
  description = "Name of the application database user."
  default     = "rwa_user"
}

variable "high_availability" {
  type        = bool
  description = "Enable Render's high-availability failover. Recommended for production; costs more."
  default     = false
}

variable "disk_size_gb" {
  type        = number
  description = "Disk size in GB. 0 (the default) leaves Render's plan default in place."
  default     = 0
}

variable "parameter_overrides" {
  type        = map(string)
  description = "PostgreSQL server parameters to override, e.g. { max_connections = \"200\" }."
  default     = {}
}

variable "ip_allow_list" {
  type = list(object({
    cidr_block  = string
    description = string
  }))
  description = "Public CIDR ranges allowed to connect. Empty means private-network access only."
  default     = []
}
