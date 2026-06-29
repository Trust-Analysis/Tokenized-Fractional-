terraform {
  backend "s3" {
    # Configured per-environment via backend config or CLI:
    # terraform init -backend-config="key=rwa-marketplace/prod/terraform.tfstate"
    #
    # bucket         = "rwa-marketplace-terraform-state"
    # key            = "rwa-marketplace/staging/terraform.tfstate"
    # region         = "us-east-1"
    # encrypt        = true
    # dynamodb_table = "rwa-marketplace-terraform-locks"
  }
}
