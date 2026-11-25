# ── Stage 1: Install production dependencies ───────────────────────────────────
# Node 26 (Active LTS). Tag + digest pin; Renovate updates both together.
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Production runtime ────────────────────────────────────────────────
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS runtime
WORKDIR /app

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy production deps from stage 1
COPY --from=deps /app/node_modules ./node_modules
# Copy application source
COPY . .

# Own the app directory to the non-root user
RUN chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "src/server.js"]
