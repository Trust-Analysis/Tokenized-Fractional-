variable "aws_region" {
  type        = string
  description = "AWS region for API Gateway and WAF deployment"
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Deployment environment (e.g., prod, staging, dev)"
  default     = "prod"
}

variable "api_gateway_stage_arn" {
  type        = string
  description = "ARN of the API Gateway stage to associate with WAF WebACL"
  default     = ""
}

variable "rate_limit_threshold" {
  type        = number
  description = "Rate limit threshold per 5 minutes per IP"
  default     = 2000
}

# ── Redis (Issue #890) ────────────────────────────────────────────────
variable "create_redis_cluster" {
  type        = bool
  description = "Whether to create the ElastiCache Redis replication group (opt-in so plan stays side-effect-free)"
  default     = false
}

variable "redis_node_type" {
  type        = string
  description = "ElastiCache node type for the Redis replication group"
  default     = "cache.t4g.small"
}

variable "redis_engine_version" {
  type        = string
  description = "Redis engine version"
  default     = "7.1"
}

variable "redis_num_cache_clusters" {
  type        = number
  description = "Number of Redis cache clusters in the replication group (>= 2 enables automatic failover)"
  default     = 2
}

variable "redis_subnet_ids" {
  type        = list(string)
  description = "Subnet IDs for the Redis subnet group (required when create_redis_cluster = true)"
  default     = []
}

variable "redis_security_group_ids" {
  type        = list(string)
  description = "Security group IDs to attach to the Redis replication group"
  default     = []
}
