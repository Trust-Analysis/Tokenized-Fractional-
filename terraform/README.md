# Terraform Infrastructure for RWA Marketplace

Defines AWS infrastructure using Terraform for reproducible deployments.

## Resources

- **VPC** — Isolated network with public/private subnets across 2 AZs
- **NAT Gateway** — Outbound internet for private resources
- **Security Groups** — Backend API (port 3001) and RDS PostgreSQL (port 5432)
- **RDS PostgreSQL** — Managed PostgreSQL 16 with automated backups
- **EC2** — Backend API server with auto-start via systemd
- **Elastic IP** — Static public IP for the backend

## Usage

### Prerequisites

- Terraform >= 1.6
- AWS credentials configured (env vars, `~/.aws/credentials`, or IAM role)

### Quick Start

```bash
# Initialize with S3 backend (recommended for teams)
terraform init \
  -backend-config="bucket=rwa-marketplace-terraform-state" \
  -backend-config="key=rwa-marketplace/staging/terraform.tfstate" \
  -backend-config="region=us-east-1"

# Or use local state (single developer)
terraform init
```

```bash
# Set required variables
export TF_VAR_rds_username="dbadmin"
export TF_VAR_rds_password="<secure-password>"
export TF_VAR_ssh_key_name="my-key-pair"

# Preview changes
terraform plan -out=tfplan

# Apply
terraform apply tfplan

# Destroy (when no longer needed)
terraform destroy
```

### Variables

| Variable               | Default       | Description                          |
|------------------------|---------------|--------------------------------------|
| `aws_region`           | `us-east-1`   | AWS region                           |
| `environment`          | `staging`     | Environment name (staging/production)|
| `vpc_cidr`             | `10.0.0.0/16` | VPC CIDR block                       |
| `backend_instance_type`| `t3.small`    | Backend EC2 instance type            |
| `rds_instance_class`   | `db.t3.micro` | RDS instance class                   |
| `rds_allocated_storage`| `20`          | RDS storage in GB                    |

### Outputs

After apply, key outputs are printed:

- `backend_public_ip` — Connect your frontend or custom domain
- `rds_endpoint` — Database connection string hostname
- `vpc_id` — VPC identifier

## Production Checklist

1. Configure S3 backend with DynamoDB locking
2. Set `deletion_protection = true` on RDS
3. Use a CI/CD pipeline (GitHub Actions) for `terraform plan/apply`
4. Store secrets in AWS Secrets Manager or Parameter Store
5. Add a CDN (CloudFront) in front of the backend
6. Configure a custom domain with Route 53 + ACM certificate
