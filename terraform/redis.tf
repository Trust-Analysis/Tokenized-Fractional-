# Redis (Issue #890)
#
# Historically Redis had NO Infrastructure-as-Code coverage: it was configured
# ad hoc (REDIS_URL env var pointing at whatever instance existed). This file
# adds Terraform coverage for a production-grade Redis (ElastiCache), which the
# backend uses for caching, rate limiting, BullMQ jobs, and the WebSocket
# cross-instance pub/sub bridge (backend/websocketRedisAdapter.js).
#
# Creation is opt-in via `var.create_redis_cluster` (default false) so that
# `terraform plan` remains side-effect-free for environments that use an
# external/dev Redis. Subnet group inputs are required when enabling it.

resource "aws_elasticache_subnet_group" "redis" {
  count = var.create_redis_cluster ? 1 : 0

  name       = "rwa-redis-subnet-group"
  subnet_ids = var.redis_subnet_ids

  tags = {
    Service   = "RwaMarketplace"
    ManagedBy = "Terraform"
  }
}

resource "aws_elasticache_replication_group" "redis" {
  count = var.create_redis_cluster ? 1 : 0

  description          = "RWA Marketplace Redis (cache, BullMQ, WebSocket pub/sub)"
  replication_group_id = "rwa-redis"
  engine               = "redis"
  engine_version       = var.redis_engine_version
  node_type            = var.redis_node_type
  num_cache_clusters   = var.redis_num_cache_clusters

  automatic_failover_enabled = var.redis_num_cache_clusters > 1
  multi_az_enabled           = var.redis_num_cache_clusters > 1

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  subnet_group_name  = aws_elasticache_subnet_group.redis[0].name
  security_group_ids = var.redis_security_group_ids

  tags = {
    Service   = "RwaMarketplace"
    ManagedBy = "Terraform"
  }
}
