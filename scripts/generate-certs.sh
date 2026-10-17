#!/usr/bin/env bash
# =============================================================================
# scripts/generate-certs.sh
#
# Generates self-signed TLS certificates for LOCAL DEVELOPMENT use.
# DO NOT use these certificates in production. Use a trusted CA (e.g.,
# Let's Encrypt) or your organisation's PKI for production deployments.
#
# Usage:
#   bash scripts/generate-certs.sh [CERTS_DIR]
#
# Defaults:
#   CERTS_DIR = ./certs  (created if it does not exist)
#
# What is generated:
#   certs/
#   ├── ca.crt            — Self-signed CA certificate
#   ├── ca.key            — CA private key          (keep secret, never deploy)
#   ├── nginx.crt         — Nginx server certificate (signed by CA)
#   ├── nginx.key         — Nginx server private key
#   ├── redis-server.crt  — Redis server certificate (signed by CA)
#   ├── redis-server.key  — Redis server private key
#   ├── client.crt        — Client certificate for Redis mTLS (signed by CA)
#   └── client.key        — Client private key for Redis mTLS
#
# After running this script, update backend/.env:
#   REDIS_TLS=true
#   REDIS_URL=rediss://localhost:6380
#   REDIS_TLS_CA=<absolute-path>/certs/ca.crt
#   REDIS_TLS_CERT=<absolute-path>/certs/client.crt
#   REDIS_TLS_KEY=<absolute-path>/certs/client.key
#   REDIS_TLS_REJECT_UNAUTHORIZED=false   # self-signed CA — dev only
# =============================================================================
set -euo pipefail

CERTS_DIR="${1:-./certs}"
DAYS=365          # certificate validity
KEY_BITS=2048     # RSA key size
COUNTRY="US"
STATE="Dev"
LOCALITY="Local"
ORG="RWA Marketplace Dev"
CA_CN="RWA Dev CA"
NGINX_CN="localhost"
REDIS_CN="redis"
CLIENT_CN="rwa-backend"

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { printf '\033[1;32m[certs]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[certs]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[certs]\033[0m ERROR: %s\n' "$*" >&2; exit 1; }

command -v openssl >/dev/null 2>&1 || die "openssl is not installed. Install it first."

mkdir -p "$CERTS_DIR"
cd "$CERTS_DIR"

SUBJ_PREFIX="/C=${COUNTRY}/ST=${STATE}/L=${LOCALITY}/O=${ORG}"

# =============================================================================
# 1. Certificate Authority (CA)
# =============================================================================
if [[ -f ca.crt ]]; then
  warn "CA certificate already exists — skipping CA generation."
  warn "Delete ${CERTS_DIR}/ca.crt and ${CERTS_DIR}/ca.key to regenerate."
else
  log "Generating CA key and self-signed certificate..."
  openssl genrsa -out ca.key $KEY_BITS 2>/dev/null
  openssl req -x509 -new -nodes \
    -key ca.key \
    -sha256 \
    -days $DAYS \
    -out ca.crt \
    -subj "${SUBJ_PREFIX}/CN=${CA_CN}"
  log "CA certificate created: ${CERTS_DIR}/ca.crt"
fi

# =============================================================================
# Helper: sign_cert <name> <cn> [san]
#   Generates a key, CSR, and certificate signed by the local CA.
# =============================================================================
sign_cert() {
  local name="$1"
  local cn="$2"
  local san="${3:-DNS:${cn},DNS:localhost,IP:127.0.0.1}"

  log "Generating ${name} key..."
  openssl genrsa -out "${name}.key" $KEY_BITS 2>/dev/null

  log "Creating ${name} CSR..."
  openssl req -new \
    -key "${name}.key" \
    -out "${name}.csr" \
    -subj "${SUBJ_PREFIX}/CN=${cn}"

  log "Signing ${name} certificate with local CA..."
  openssl x509 -req \
    -in "${name}.csr" \
    -CA ca.crt \
    -CAkey ca.key \
    -CAcreateserial \
    -out "${name}.crt" \
    -days $DAYS \
    -sha256 \
    -extfile <(printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\n" "$san")

  rm -f "${name}.csr"
  log "${name} certificate created: ${CERTS_DIR}/${name}.crt"
}

sign_client_cert() {
  local name="$1"
  local cn="$2"

  log "Generating ${name} (client) key..."
  openssl genrsa -out "${name}.key" $KEY_BITS 2>/dev/null

  log "Creating ${name} (client) CSR..."
  openssl req -new \
    -key "${name}.key" \
    -out "${name}.csr" \
    -subj "${SUBJ_PREFIX}/CN=${cn}"

  log "Signing ${name} (client) certificate with local CA..."
  openssl x509 -req \
    -in "${name}.csr" \
    -CA ca.crt \
    -CAkey ca.key \
    -CAcreateserial \
    -out "${name}.crt" \
    -days $DAYS \
    -sha256 \
    -extfile <(printf "subjectAltName=DNS:%s\nextendedKeyUsage=clientAuth\n" "$cn")

  rm -f "${name}.csr"
  log "${name} client certificate created: ${CERTS_DIR}/${name}.crt"
}

# =============================================================================
# 2. Nginx server certificate
# =============================================================================
if [[ -f nginx.crt ]]; then
  warn "nginx.crt already exists — skipping."
else
  sign_cert "nginx" "$NGINX_CN" "DNS:${NGINX_CN},DNS:localhost,IP:127.0.0.1"
fi

# =============================================================================
# 3. Redis server certificate
# =============================================================================
if [[ -f redis-server.crt ]]; then
  warn "redis-server.crt already exists — skipping."
else
  sign_cert "redis-server" "$REDIS_CN" "DNS:${REDIS_CN},DNS:localhost,IP:127.0.0.1"
fi

# =============================================================================
# 4. Client certificate for Redis mTLS
# =============================================================================
if [[ -f client.crt ]]; then
  warn "client.crt already exists — skipping."
else
  sign_client_cert "client" "$CLIENT_CN"
fi

# =============================================================================
# 5. Lock down private key permissions
# =============================================================================
chmod 600 ca.key nginx.key redis-server.key client.key 2>/dev/null || true
chmod 644 ca.crt nginx.crt redis-server.crt client.crt 2>/dev/null || true

# =============================================================================
# 6. Summary
# =============================================================================
cat <<EOF

$(printf '\033[1;32m✓ Certificates written to: %s\033[0m' "$(cd . && pwd)")

  ca.crt            — CA certificate (trust anchor)
  ca.key            — CA private key  *** keep secret ***
  nginx.crt         — Nginx server certificate
  nginx.key         — Nginx server private key
  redis-server.crt  — Redis server certificate
  redis-server.key  — Redis server private key
  client.crt        — Backend client certificate (mTLS)
  client.key        — Backend client private key

Add to backend/.env:

  REDIS_TLS=true
  REDIS_URL=rediss://localhost:6380
  REDIS_TLS_CA=$(cd . && pwd)/ca.crt
  REDIS_TLS_CERT=$(cd . && pwd)/client.crt
  REDIS_TLS_KEY=$(cd . && pwd)/client.key
  REDIS_TLS_REJECT_UNAUTHORIZED=false   # self-signed — dev only

$(printf '\033[1;33mWARNING: These are self-signed dev-only certificates.\033[0m')
$(printf '\033[1;33mUse a trusted CA (Let'\''s Encrypt, etc.) in production.\033[0m')
EOF
