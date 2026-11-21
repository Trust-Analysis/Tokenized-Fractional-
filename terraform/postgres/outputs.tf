output "postgres_id" {
  description = "Render database ID. Use it with `terraform import` to adopt an existing instance without recreating it."
  value       = render_postgres.primary.id
}

output "postgres_name" {
  description = "Render resource name."
  value       = render_postgres.primary.name
}

output "region" {
  description = "Region the database runs in. Must match the backend services."
  value       = render_postgres.primary.region
}

# Connection strings are secrets: they are marked sensitive so Terraform will
# not print them in plan output or CI logs.
#
# Read the individual fields with:
#   terraform output -json connection_info
output "connection_info" {
  description = "Sensitive connection details (internal/external connection strings, password, psql command)."
  value       = render_postgres.primary.connection_info
  sensitive   = true
}
