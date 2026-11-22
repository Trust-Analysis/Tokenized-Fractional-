variable "bucket_name" {
  type        = string
  description = "S3 bucket name for immutable database backups"
}

variable "github_oidc_provider_arn" {
  type        = string
  description = "IAM OIDC provider ARN for token.actions.githubusercontent.com"
}

variable "github_repo_sub" {
  type        = string
  description = "GitHub OIDC sub claim, e.g. repo:Trust-Analysis/Tokenized-Fractional-:ref:refs/heads/main"
}

resource "aws_s3_bucket" "backups" {
  bucket        = var.bucket_name
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 30
    }
  }
  depends_on = [aws_s3_bucket_versioning.backups]
}

resource "aws_iam_role" "github_backup_oidc" {
  name = "${var.bucket_name}-github-oidc-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = var.github_repo_sub
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "backup_bucket_scoped" {
  name = "${var.bucket_name}-scoped-policy"
  role = aws_iam_role.github_backup_oidc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ]
      Resource = [
        aws_s3_bucket.backups.arn,
        "${aws_s3_bucket.backups.arn}/*"
      ]
    }]
  })
}
