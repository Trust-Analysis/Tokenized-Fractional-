#!/bin/bash
set -euo pipefail

# Environment variables (injected by Terraform templatefile)
export ENVIRONMENT="${environment}"
export RDS_ENDPOINT="${rds_endpoint}"
export RDS_DATABASE="${rds_database}"
export RDS_USERNAME="${rds_username}"
export RDS_PASSWORD="${rds_password}"
export BACKEND_PORT="${backend_port}"
export FRONTEND_ORIGIN="${frontend_origin}"

# Update system
dnf update -y

# Install Node.js 20
dnf install -y nodejs

# Install Docker (optional, for containerized backend)
dnf install -y docker
systemctl enable docker
systemctl start docker

# Clone or pull latest backend code
# In production, use a proper CI/CD pipeline.
# For demo, the app is expected to be deployed manually or via CI.

# Create backend directory
mkdir -p /opt/rwa-backend

# Write .env file
cat > /opt/rwa-backend/.env <<EOF
NODE_ENV=${ENVIRONMENT}
PORT=${BACKEND_PORT}
DATABASE_URL=postgresql://${RDS_USERNAME}:${RDS_PASSWORD}@${RDS_ENDPOINT}/${RDS_DATABASE}
CORS_ORIGINS=${FRONTEND_ORIGIN}
ADMIN_API_KEY=change-in-production
EOF

# Install PM2 globally for process management
npm install -g pm2

# Create a systemd service for the backend (if not using Docker)
cat > /etc/systemd/system/rwa-backend.service <<UNIT
[Unit]
Description=RWA Marketplace Backend
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/rwa-backend
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
EnvironmentFile=/opt/rwa-backend/.env

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reexec
systemctl enable rwa-backend
systemctl start rwa-backend

echo "Backend setup complete"
