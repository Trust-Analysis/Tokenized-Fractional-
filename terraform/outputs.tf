output "web_acl_arn" {
  description = "The ARN of the WAF WebACL"
  value       = aws_wafv2_web_acl.api_waf.arn
}

output "web_acl_id" {
  description = "The ID of the WAF WebACL"
  value       = aws_wafv2_web_acl.api_waf.id
}

output "web_acl_capacity" {
  description = "The capacity units (WCU) used by the WebACL"
  value       = aws_wafv2_web_acl.api_waf.capacity
}

# ── Redis (Issue #890) ────────────────────────────────────────────────
output "redis_primary_endpoint" {
  description = "Primary endpoint of the Redis replication group (empty when create_redis_cluster = false)"
  value       = try(aws_elasticache_replication_group.redis[0].primary_endpoint_address, "")
}

output "redis_reader_endpoint" {
  description = "Reader endpoint of the Redis replication group (empty when create_redis_cluster = false)"
  value       = try(aws_elasticache_replication_group.redis[0].reader_endpoint_address, "")
}
