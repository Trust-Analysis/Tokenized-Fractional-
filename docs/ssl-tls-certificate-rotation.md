# SSL/TLS Certificate Rotation Runbook

This document describes the certificate rotation procedures for the RWA Marketplace.
Follow these procedures to replace expiring or compromised certificates with zero or
minimal service disruption.

## Overview of Certificates

| Certificate | Used by | Default validity | Location |
|---|---|---|---|
| `ca.crt` / `ca.key` | Trust anchor for all other certs | 1 year (dev) / 10 years (prod) | `./certs/` |
| `nginx.crt` / `nginx.key` | Nginx TLS termination | 90 days (Let's Encrypt) / 1 year (self-signed) | `/etc/ssl/rwa/` |
| `redis-server.crt` / `redis-server.key` | Redis server TLS | 1 year | `/etc/ssl/rwa/` |
| `client.crt` / `client.key` | Backend → Redis mTLS client auth | 1 year | `/etc/ssl/rwa/` |

---

## 1. Pre-Rotation Checklist

Before rotating any certificate:

- [ ] Confirm the new certificate has been generated and validated
      (`openssl verify -CAfile ca.crt <new-cert>.crt`)
- [ ] Confirm the new key matches the new certificate
      (`openssl x509 -noout -modulus -in new.crt | md5sum` must equal
       `openssl rsa -noout -modulus -in new.key | md5sum`)
- [ ] Back up the existing certificate and key:
      ```bash
      cp /etc/ssl/rwa/nginx.crt /etc/ssl/rwa/nginx.crt.bak-$(date +%Y%m%d)
      cp /etc/ssl/rwa/nginx.key /etc/ssl/rwa/nginx.key.bak-$(date +%Y%m%d)
      ```
- [ ] Ensure you have rollback access (SSH, container access, or an orchestrator rollback)

---

## 2. Nginx Certificate Rotation (zero-downtime)

Nginx supports a graceful configuration reload that replaces certificates
without dropping established connections.

### Step-by-step

```bash
# 1. Place the new certificate and key on the server
cp new-nginx.crt /etc/ssl/rwa/nginx.crt
cp new-nginx.key /etc/ssl/rwa/nginx.key
chmod 644 /etc/ssl/rwa/nginx.crt
chmod 600 /etc/ssl/rwa/nginx.key

# 2. Test that the new config is syntactically valid
nginx -t -c /path/to/nginx/nginx.conf

# 3. Reload Nginx — zero-downtime (workers finish existing requests,
#    then pick up the new certificate)
nginx -s reload
# OR, if running as a systemd service:
systemctl reload nginx

# 4. Verify the new certificate is being served
openssl s_client -connect localhost:443 -servername localhost </dev/null \
  | openssl x509 -noout -dates
```

### Docker Compose

```bash
# The ./certs volume is mounted read-only into the nginx container.
# Replace the files on the host, then reload nginx inside the container:
docker compose exec frontend-prod nginx -s reload
```

### Let's Encrypt / Certbot (automated)

Set up a Certbot renewal hook that reloads Nginx after each successful renewal:

```bash
# /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
#!/bin/bash
nginx -s reload
```

Certbot runs `certbot renew` twice daily via a systemd timer or cron job.
Certificates are automatically renewed when they are within 30 days of expiry.

---

## 3. Redis Server Certificate Rotation (rolling)

Redis supports `CONFIG REWRITE` and live TLS certificate updates in some
versions, but the safest zero-downtime approach for Redis 7 is a brief
connection interruption via a restart with a new certificate already in place.

### Step-by-step

```bash
# 1. Generate a new Redis server certificate (signed by the same CA)
openssl genrsa -out redis-server-new.key 2048
openssl req -new -key redis-server-new.key \
  -out redis-server-new.csr \
  -subj "/C=US/ST=Prod/O=RWA Marketplace/CN=redis"
openssl x509 -req \
  -in redis-server-new.csr \
  -CA /etc/ssl/rwa/ca.crt -CAkey /etc/ssl/rwa/ca.key -CAcreateserial \
  -out redis-server-new.crt -days 365 -sha256 \
  -extfile <(printf "subjectAltName=DNS:redis,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n")

# 2. Verify
openssl verify -CAfile /etc/ssl/rwa/ca.crt redis-server-new.crt

# 3. Atomically swap the files (cp then mv ensures a consistent state)
cp redis-server-new.crt /etc/ssl/rwa/redis-server.crt.new
cp redis-server-new.key /etc/ssl/rwa/redis-server.key.new
mv /etc/ssl/rwa/redis-server.crt.new /etc/ssl/rwa/redis-server.crt
mv /etc/ssl/rwa/redis-server.key.new /etc/ssl/rwa/redis-server.key
chmod 644 /etc/ssl/rwa/redis-server.crt
chmod 600 /etc/ssl/rwa/redis-server.key

# 4. Restart Redis (brief interruption — cache will be cold briefly)
docker compose restart redis-tls
# OR: systemctl restart redis

# 5. Confirm Redis is accepting TLS connections
redis-cli --tls \
  --cacert /etc/ssl/rwa/ca.crt \
  --cert   /etc/ssl/rwa/client.crt \
  --key    /etc/ssl/rwa/client.key \
  -p 6380 ping
```

The backend will automatically reconnect after Redis restarts (ioredis retries
on error). Cache will be cold for a few seconds; the JSON data store is
unaffected.

---

## 4. Client Certificate Rotation (Redis mTLS)

Client certs authenticate the backend to Redis. Because Redis will refuse
connections from backends presenting an expired client cert, rotate before
expiry.

### Strategy: parallel certs (zero-downtime)

Redis 7 supports multiple CA certs via the `--tls-ca-cert-dir` option, enabling
a graceful double-write window.

```bash
# 1. Generate a new client cert signed by the same CA
openssl genrsa -out client-new.key 2048
openssl req -new -key client-new.key \
  -out client-new.csr \
  -subj "/C=US/ST=Prod/O=RWA Marketplace/CN=rwa-backend"
openssl x509 -req \
  -in client-new.csr \
  -CA /etc/ssl/rwa/ca.crt -CAkey /etc/ssl/rwa/ca.key -CAcreateserial \
  -out client-new.crt -days 365 -sha256 \
  -extfile <(printf "subjectAltName=DNS:rwa-backend\nextendedKeyUsage=clientAuth\n")

# 2. Update the backend env vars (in .env or secret store)
#    Point to the new cert BEFORE removing the old one so there is no gap.
REDIS_TLS_CERT=/etc/ssl/rwa/client-new.crt
REDIS_TLS_KEY=/etc/ssl/rwa/client-new.key

# 3. Rolling-restart the backend to pick up the new cert
docker compose up -d --no-deps backend
# OR: systemctl restart rwa-backend

# 4. Verify connectivity
curl -sf http://localhost:3001/health | jq .dependencies.redis

# 5. Once confirmed, delete the old cert
rm /etc/ssl/rwa/client.crt /etc/ssl/rwa/client.key

# 6. Rename new → canonical names
mv /etc/ssl/rwa/client-new.crt /etc/ssl/rwa/client.crt
mv /etc/ssl/rwa/client-new.key /etc/ssl/rwa/client.key
```

---

## 5. CA Certificate Rotation

Rotating the CA is the most disruptive operation. All leaf certificates signed
by the old CA will stop being trusted once it is removed.

### Pre-conditions

- New CA is generated and stored securely
- All leaf certs (nginx, redis-server, client) are re-signed with the new CA
- Both old and new CAs are temporarily trusted in Redis (`tls-ca-cert-dir`)

### Step-by-step

```bash
# 1. Generate new CA
openssl genrsa -out ca-new.key 4096
openssl req -x509 -new -nodes -key ca-new.key -sha256 -days 3650 \
  -out ca-new.crt -subj "/C=US/ST=Prod/O=RWA Marketplace/CN=RWA Production CA v2"

# 2. Re-sign all leaf certificates with the new CA (see sections 2–4)

# 3. Create a CA bundle containing BOTH old and new CAs
cat /etc/ssl/rwa/ca.crt ca-new.crt > /etc/ssl/rwa/ca-bundle.crt

# 4. Point Redis to the bundle (accepts both old and new leaf certs)
#    redis.conf: tls-ca-cert-file /etc/ssl/rwa/ca-bundle.crt
docker compose restart redis-tls

# 5. Deploy all new leaf certs to all services (sections 2–4)

# 6. Once all services use new certs, remove old CA from bundle
cp ca-new.crt /etc/ssl/rwa/ca.crt
cp ca-new.key /etc/ssl/rwa/ca.key
docker compose restart redis-tls

# 7. Update REDIS_TLS_CA in backend .env to point to new ca.crt
docker compose up -d --no-deps backend
```

---

## 6. Expiry Monitoring

Proactively monitor certificate expiry to avoid service disruption.

### Shell script (run in cron)

```bash
#!/bin/bash
# /usr/local/bin/check-cert-expiry.sh
ALERT_DAYS=30
CERTS=(
  /etc/ssl/rwa/nginx.crt
  /etc/ssl/rwa/redis-server.crt
  /etc/ssl/rwa/client.crt
  /etc/ssl/rwa/ca.crt
)

for cert in "${CERTS[@]}"; do
  expiry=$(openssl x509 -enddate -noout -in "$cert" | cut -d= -f2)
  expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null || date -jf "%b %e %T %Y %Z" "$expiry" +%s)
  now_epoch=$(date +%s)
  days_left=$(( (expiry_epoch - now_epoch) / 86400 ))

  if [[ $days_left -le $ALERT_DAYS ]]; then
    echo "WARNING: $cert expires in $days_left days ($expiry)" >&2
    # Optionally: send alert via PagerDuty, Slack, email, etc.
  else
    echo "OK: $cert expires in $days_left days"
  fi
done
```

Add to crontab:
```cron
0 8 * * * /usr/local/bin/check-cert-expiry.sh >> /var/log/cert-expiry.log 2>&1
```

### Using openssl directly

```bash
# Check days remaining for a specific cert
openssl x509 -enddate -noout -in /etc/ssl/rwa/nginx.crt

# Check the live cert served by Nginx
echo | openssl s_client -connect localhost:443 2>/dev/null \
  | openssl x509 -noout -dates
```

---

## 7. Rollback Procedure

If a rotation introduces a regression (e.g., backend cannot connect to Redis):

```bash
# 1. Restore backed-up certificates
cp /etc/ssl/rwa/nginx.crt.bak-<date>  /etc/ssl/rwa/nginx.crt
cp /etc/ssl/rwa/nginx.key.bak-<date>  /etc/ssl/rwa/nginx.key

# 2. Restart affected services
nginx -s reload
docker compose restart redis-tls backend

# 3. Verify health
curl -sf http://localhost:3001/health | jq .
```

---

## 8. Security Notes

- Private keys (`*.key`, `ca.key`) must be **readable only by the service user**
  (`chmod 600`). Never commit them to version control.
- The CA private key (`ca.key`) should be stored **offline or in a hardware
  security module (HSM)** in production. Only bring it online to sign new certs.
- Rotate all certificates immediately if a private key is suspected to be
  compromised. Treat the incident as a security breach.
- For production, prefer a managed PKI (AWS ACM, HashiCorp Vault PKI, or
  Let's Encrypt) over self-managed certificates.
- `REDIS_TLS_REJECT_UNAUTHORIZED=false` must never be set in production. It
  disables certificate validation entirely, defeating the purpose of TLS.
