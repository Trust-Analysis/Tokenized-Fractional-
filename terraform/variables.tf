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
