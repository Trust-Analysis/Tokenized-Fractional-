# AWS WAF WebACL for API Gateway (GraphQL & REST endpoints)
# Issue #617: Configure AWS WAF Rules for API Gateway

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_wafv2_web_acl" "api_waf" {
  name        = "rwa-api-webacl"
  description = "AWS WAF WebACL protecting RWA API Gateway GraphQL and REST endpoints"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # 1. Custom rate-limiting rule: IPs exceeding 2000 requests per 5 minutes
  rule {
    name     = "RateLimit2000Per5Minutes"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
        evaluation_window_sec = 300
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimit2000Per5MinutesMetric"
      sampled_requests_enabled   = true
    }
  }

  # 2. AWS Managed Rules: Core Rule Set (CRS)
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # 3. AWS Managed Rules: SQL Injection (SQLi) protection
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesSQLiRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "RwaApiWebAclMetric"
    sampled_requests_enabled   = true
  }

  tags = {
    Service   = "RwaMarketplaceApi"
    ManagedBy = "Terraform"
  }
}
