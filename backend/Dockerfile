# ── Stage 1: Install production dependencies ───────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Runtime image ─────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Copy deps and source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "index.js"]
