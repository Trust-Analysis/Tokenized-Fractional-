#!/usr/bin/env bash
# =============================================================================
# SSL/TLS Automation with Let's Encrypt
#
# This script automates the process of obtaining and renewing SSL/TLS
# certificates from Let's Encrypt using Certbot. It configures:
#   - Certificate issuance for the specified domain
#   - Auto-renewal via a cron job
#   - nginx configuration for HTTPS
#   - HTTP to HTTPS redirect
#
# Usage:
#   ./scripts/setup-ssl.sh <domain> [email]
#
# Example:
#   ./scripts/setup-ssl.sh rwa-marketplace.example.com admin@example.com
#
# Prerequisites:
#   - nginx installed and running
#   - Ports 80 and 443 accessible from the internet
#   - DNS A record pointing to this server
# =============================================================================

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [ -z "$DOMAIN" ]; then
    echo "Usage: $0 <domain> [email]"
    echo "Example: $0 rwa-marketplace.example.com admin@example.com"
    exit 1
fi

# ── Step 1: Install Certbot ───────────────────────────────────────────────────

echo "[1/6] Installing Certbot..."

if command -v apt-get &>/dev/null; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq certbot python3-certbot-nginx
elif command -v yum &>/dev/null; then
    sudo yum install -y epel-release
    sudo yum install -y certbot python3-certbot-nginx
elif command -v dnf &>/dev/null; then
    sudo dnf install -y certbot python3-certbot-nginx
else
    echo "Unsupported package manager. Install certbot manually: https://certbot.eff.org/"
    exit 1
fi

echo "Certbot installed successfully."

# ── Step 2: Obtain Certificate ────────────────────────────────────────────────

echo "[2/6] Obtaining certificate for $DOMAIN..."

CERTBOT_ARGS="--nginx --non-interactive --agree-tos --domains $DOMAIN"
if [ -n "$EMAIL" ]; then
    CERTBOT_ARGS="$CERTBOT_ARGS --email $EMAIL"
else
    CERTBOT_ARGS="$CERTBOT_ARGS --register-unsafely-without-email"
fi

sudo certbot $CERTBOT_ARGS

echo "Certificate obtained successfully."

# ── Step 3: Configure nginx for HTTPS ─────────────────────────────────────────

echo "[3/6] Configuring nginx for HTTPS..."

NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
if [ -f "$NGINX_CONF" ]; then
    echo "Nginx config already exists at $NGINX_CONF, skipping."
else
    sudo tee "$NGINX_CONF" > /dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/$DOMAIN/chain.pem;

    # Modern TLS configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # OCSP stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 1.1.1.1 8.8.8.8 valid=300s;
    resolver_timeout 5s;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Logging
    access_log /var/log/nginx/${DOMAIN}_access.log;
    error_log /var/log/nginx/${DOMAIN}_error.log;

    # Proxy API requests to the backend
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Proxy all other requests to the frontend
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
    sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/
    echo "Nginx config written to $NGINX_CONF"
fi

# ── Step 4: Verify nginx configuration ────────────────────────────────────────

echo "[4/6] Verifying nginx configuration..."

sudo nginx -t

# ── Step 5: Reload nginx ──────────────────────────────────────────────────────

echo "[5/6] Reloading nginx..."

sudo systemctl reload nginx || sudo nginx -s reload

echo "nginx reloaded with HTTPS configuration."

# ── Step 6: Set up auto-renewal cron job ──────────────────────────────────────

echo "[6/6] Setting up auto-renewal cron job..."

CRON_JOB="0 3 * * * /usr/bin/certbot renew --quiet --post-hook \"systemctl reload nginx\""
if crontab -l 2>/dev/null | grep -q "certbot renew"; then
    echo "Certbot renewal cron job already exists, skipping."
else
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "Auto-renewal cron job installed."
fi

# Test renewal
echo "Testing certificate renewal..."
sudo certbot renew --dry-run

echo ""
echo "SSL/TLS setup complete for $DOMAIN!"
echo "  - HTTPS: https://$DOMAIN"
echo "  - Certificate auto-renews daily at 3:00 AM"
echo "  - HTTP automatically redirects to HTTPS"
