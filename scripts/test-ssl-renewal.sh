#!/usr/bin/env bash
# =============================================================================
# SSL/TLS Certificate Renewal Test
#
# Tests that the auto-renewal cron job is properly configured and that
# the certificate can be renewed without errors.
#
# Usage:
#   ./scripts/test-ssl-renewal.sh [domain]
#
# If no domain is provided, it runs `certbot renew --dry-run` for all domains.
# =============================================================================

set -euo pipefail

echo "=== SSL/TLS Renewal Test ==="
echo ""

# Check certbot is installed
if ! command -v certbot &>/dev/null; then
    echo "ERROR: certbot is not installed. Run setup-ssl.sh first."
    exit 1
fi

# Check that certificates exist
if [ ! -d "/etc/letsencrypt/live" ]; then
    echo "ERROR: No Let's Encrypt certificates found. Run setup-ssl.sh first."
    exit 1
fi

DOMAIN="${1:-}"

echo "Current certificates:"
sudo certbot certificates
echo ""

if [ -n "$DOMAIN" ]; then
    echo "Testing renewal for $DOMAIN..."
    sudo certbot renew --domains "$DOMAIN" --dry-run
else
    echo "Testing renewal for all certificates..."
    sudo certbot renew --dry-run
fi

echo ""
echo "Checking cron job..."
if crontab -l 2>/dev/null | grep -q "certbot renew"; then
    echo "Auto-renewal cron job is installed:"
    crontab -l | grep "certbot renew"
else
    echo "WARNING: Auto-renewal cron job is NOT installed."
    echo "Run setup-ssl.sh to install it, or add this line to crontab:"
    echo "  0 3 * * * /usr/bin/certbot renew --quiet --post-hook \"systemctl reload nginx\""
fi

echo ""
echo "Checking certificate expiry..."
sudo certbot certificates | grep -E "Expiry Date|VALID"

echo ""
echo "SSL/TLS renewal test complete."
