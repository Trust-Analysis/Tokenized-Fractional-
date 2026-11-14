# ── Stage 1: Install production dependencies ───────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Build stage (dev dependencies for build steps) ────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# ── Stage 3: Production runtime ────────────────────────────────────────────────
FROM node:20-alpine AS runtime
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

CMD ["node", "index.js"]
