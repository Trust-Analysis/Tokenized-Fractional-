# ── Stage: development ────────────────────────────────────────────────────────
# Node 26 (Active LTS). Tag + digest pin; Renovate updates both together.
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# ── Stage: build ──────────────────────────────────────────────────────────────
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_CONTRACT_ID
ARG VITE_RPC_URL
ARG VITE_NETWORK_PASSPHRASE
ARG VITE_API_URL
ARG VITE_CDN_URL
RUN npm run build

# ── Stage: production (serve built assets) ────────────────────────────────────
# nginx:alpine pinned by digest; Renovate keeps the digest current.
FROM nginx:alpine@sha256:fb4658584bd9a916ffb6f6e365f97c25cfdb2923801f551ea08356e695f14ff7 AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.prod.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
