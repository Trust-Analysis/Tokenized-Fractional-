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
