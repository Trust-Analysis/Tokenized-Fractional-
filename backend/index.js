// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import 'dotenv/config';
import { validateEnv } from './env.js';
validateEnv();
import { randomUUID } from 'crypto';
import express from 'express';
import { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import * as Sentry from '@sentry/node';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setTimeout } from 'timers/promises';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './docs.js';
import yoga from './graphql/index.js';
import { createETagMiddleware, invalidateLedger } from './graphql/etag.js';
import { cacheGet, cacheSet, cacheDel } from './cache.js';
import { RateLimiterService } from './src/services/rateLimiterService.js';
import { AnomalyDetector } from './src/services/anomalyDetector.js';
import { GeoLimiter } from './src/services/geoLimiter.js';
import { RateLimitAnalytics } from './src/services/rateLimitAnalytics.js';
import { BillingService } from './src/services/billingService.js';
import { createRateLimiter } from './src/middleware/rateLimiter.js';
import { createGraphQLRateLimiter } from './src/middleware/tieredRateLimiter.js';
import { createRateLimitAdminRoutes } from './src/routes/rateLimitAdmin.js';
import { metricsMiddleware, metricsHandler } from './src/services/metricsService.js';
import { applyCursorPagination, CursorError, paginationErrorHandler, SORT_FIELDS } from './src/services/cursorPagination.js';
import { parsePaginationParams } from './src/middleware/cursorPagination.js';
import {
  createProblemDetailsInterceptor,
  problemDetailsNotFoundHandler,
  problemDetailsErrorHandler,
} from './src/middleware/problemDetails.js';
import { generateOpenapiSpec } from './src/services/openapiService.js';
import { getDatabase } from './src/services/database.js';
import { wsManager } from './websocket.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// multer memoryStorage keeps the file in memory as a Buffer (req.file.buffer).
// We never write documents to disk — they go straight from memory to Pinata.
// 10MB limit is generous for PDFs and title deeds.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    // Only accept PDFs and common image formats for now
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PDF, JPEG, PNG, WEBP`));
    }
  },
});
const PORT = process.env.PORT || 3001;
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:4173'];

// ── Logger ────────────────────────────────────────────────────────────────────


// ── Sentry ────────────────────────────────────────────────────────────────────
if (process.env.SENTRY_DSN && process.env.NODE_ENV !== 'test') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,
    profilesSampleRate: process.env.SENTRY_PROFILES_SAMPLE_RATE
      ? parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE)
      : 0.1,
    integrations: [
      Sentry.httpIntegration({ breadcrumbs: true }),
      Sentry.expressIntegration(),
    ],
  });
  logger.info({ dsnPrefix: process.env.SENTRY_DSN.slice(0, 30) }, 'Sentry initialized');
}

// ── Data helpers ──────────────────────────────────────────────────────────────
function getDataFile() {
  return join(__dirname, process.env.DATA_FILE || 'data.json');
}

function loadData() {
  const file = getDataFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    logger.error('Corrupted data file, starting fresh');
    return {};
  }
}

function saveData(data) {
  writeFileSync(getDataFile(), JSON.stringify(data, null, 2), 'utf-8');
  // Bump the ledger revision so GraphQL ETags are invalidated on any data change.
  invalidateLedger();
}

export function validateContractId(id) {
  return typeof id === 'string' && id.length >= 50 && id.startsWith('C');
}

export function validateRwaBody(body) {
  const required = ['title', 'location', 'description', 'assetType'];
  const missing = required.filter(f => !body[f]);
  if (missing.length > 0) return `Missing required fields: ${missing.join(', ')}`;
  return null;
}

function cacheKey(contractId) {
  return `rwa:${contractId}`;
}

// ── Full-Text Search Index (Issue #181) ────────────────────────────────────────
// In-memory inverted index: term → Set of contractIds
let _searchIndex = null;

/**
 * Tokenise a string into lowercase words (removes punctuation).
 */
export function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Build or rebuild the full-text inverted index from the current data store.
 * Called once at startup and after every mutating operation.
 */
export function buildSearchIndex(data) {
  const index = {}; // term → { contractId: tf }
  const docCount = {}; // contractId → total token count

  for (const [contractId, meta] of Object.entries(data)) {
    const fields = [
      { value: meta.title,       weight: 3 },
      { value: meta.location,    weight: 2 },
      { value: meta.description, weight: 1 },
      { value: meta.assetType,   weight: 2 },
    ];

    const termFreq = {};
    let total = 0;
    for (const { value, weight } of fields) {
      const tokens = tokenize(value);
      for (const token of tokens) {
        termFreq[token] = (termFreq[token] || 0) + weight;
        total += weight;
      }
    }
    docCount[contractId] = total || 1;

    for (const [term, freq] of Object.entries(termFreq)) {
      if (!index[term]) index[term] = {};
      index[term][contractId] = freq / docCount[contractId]; // TF
    }
  }

  _searchIndex = { index, totalDocs: Object.keys(data).length };
  return _searchIndex;
}

/**
 * Ensure the index is built (lazy init).
 */
function getSearchIndex() {
  if (!_searchIndex) buildSearchIndex(loadData());
  return _searchIndex;
}

/**
 * Sync the search index after data mutations (fire-and-forget safe).
 */
export function syncSearchIndex() {
  try {
    buildSearchIndex(loadData());
  } catch (err) {
    logger.error({ err }, 'Failed to sync search index');
  }
}

/**
 * Score assets for a query using TF-IDF-like relevance.
 * Returns an array of { contractId, score } sorted descending.
 */
export function scoreSearch(query, data) {
  const { index, totalDocs } = getSearchIndex();
  const terms = tokenize(query);
  if (terms.length === 0) return Object.keys(data).map(id => ({ contractId: id, score: 1 }));

  const scores = {};
  for (const term of terms) {
    const postings = index[term] || {};
    const df = Object.keys(postings).length;
    if (df === 0) continue;
    // IDF: log(N / df)
    const idf = Math.log((totalDocs + 1) / (df + 1)) + 1;
    for (const [contractId, tf] of Object.entries(postings)) {
      scores[contractId] = (scores[contractId] || 0) + tf * idf;
    }
  }

  return Object.entries(scores)
    .map(([contractId, score]) => ({ contractId, score }))
    .sort((a, b) => b.score - a.score);
}

function adminAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const expected = process.env.ADMIN_API_KEY || 'dev-key-change-in-production';
  if (!apiKey || apiKey !== expected) {
    req.log?.warn({ hasKey: !!apiKey }, 'Unauthorized API key attempt');
    return res.status(401).json({ error: 'Unauthorized: invalid or missing API key', requestId: req.requestId });
  }
  req.log?.info('Admin API key used');
  next();
}

const ASSET_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

function isApproved(asset) {
  return !asset.status || asset.status === ASSET_STATUS.APPROVED;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getPublicSiteUrl(req) {
  return (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || `${req.protocol}://${req.get('host')}`)
    .replace(/\/$/, '');
}

function buildSitemap(req) {
  const data = loadData();
  const updatedAt = new Date().toISOString();
  const urls = [
    `    <url><loc>${escapeXml(`${getPublicSiteUrl(req)}/`)}</loc><lastmod>${updatedAt}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...Object.entries(data)
      .filter(([, meta]) => isApproved(meta))
      .map(([contractId, meta]) => {
        const lastmod = new Date(meta.updatedAt || meta.createdAt || updatedAt).toISOString();
        const loc = `${getPublicSiteUrl(req)}/asset/${encodeURIComponent(contractId)}`;
        return `    <url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`;
      }),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
  ].join('\n');
}

// ── Webhook helpers ────────────────────────────────────────────────────────────
const WEBHOOK_EVENTS = {
  CREATED: 'asset.created',
  UPDATED: 'asset.updated',
  DELETED: 'asset.deleted',
  APPROVED: 'asset.approved',
  REJECTED: 'asset.rejected',
};

const WEBHOOK_VALID_EVENTS = Object.values(WEBHOOK_EVENTS);

function getWebhookFile() {
  return join(__dirname, process.env.WEBHOOK_DATA_FILE || 'webhooks.json');
}

function loadWebhooks() {
  const file = getWebhookFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    logger.error('Corrupted webhook data file, starting fresh');
    return {};
  }
}

function saveWebhooks(data) {
  writeFileSync(getWebhookFile(), JSON.stringify(data, null, 2), 'utf-8');
}

function validateWebhookBody(body) {
  if (!body.url || typeof body.url !== 'string') return 'url is required';
  try {
    new URL(body.url);
  } catch {
    return 'url must be a valid URL';
  }
  if (!Array.isArray(body.events) || body.events.length === 0) {
    return 'events must be a non-empty array';
  }
  const invalid = body.events.filter(e => !WEBHOOK_VALID_EVENTS.includes(e));
  if (invalid.length > 0) {
    return `Invalid events: ${invalid.join(', ')}. Valid: ${WEBHOOK_VALID_EVENTS.join(', ')}`;
  }
  return null;
}

function generateWebhookId() {
  return 'wh_' + randomUUID().replace(/-/g, '').slice(0, 16);
}

async function deliverToWebhook(webhook, payload) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'X-Webhook-Event': payload.event,
    'X-Webhook-Delivery': randomUUID(),
  };

  const response = await fetch(webhook.url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Webhook responded with ${response.status}`);
  }
}

async function deliverWebhookWithRetry(webhook, payload, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await deliverToWebhook(webhook, payload);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await setTimeout(1000 * attempt);
      }
    }
  }
  throw lastError;
}

async function fireWebhooks(event, data) {
  const webhooks = loadWebhooks();
  const active = Object.values(webhooks).filter(w => w.active && w.events.includes(event));
  if (active.length === 0) {
    logger.info({ event, webhookCount: Object.keys(webhooks).length }, 'No active webhooks for event');
    return;
  }
  logger.info({ event, count: active.length, urls: active.map(w => w.url) }, 'Firing webhooks');

  const payload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const results = await Promise.allSettled(
    active.map(w => deliverWebhookWithRetry(w, payload)),
  );

  let changed = false;
  active.forEach((webhook, i) => {
    if (results[i].status === 'rejected') {
      webhook.failureCount = (webhook.failureCount || 0) + 1;
      webhook.lastFailureAt = new Date().toISOString();
      if (webhook.failureCount >= 5) {
        webhook.active = false;
        logger.warn({ webhookId: webhook.id, url: webhook.url }, 'Webhook auto-disabled after 5 failures');
      }
    } else {
      webhook.failureCount = 0;
      webhook.lastSuccessAt = new Date().toISOString();
    }
    webhook.updatedAt = new Date().toISOString();
    changed = true;
  });

  if (changed) {
    saveWebhooks(webhooks);
  }
}

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();

// Sentry request handler must be the first middleware
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

// Prometheus metrics for backend observability (Issue #518)
app.use(metricsMiddleware);
app.get('/metrics', metricsHandler);

app.use(helmet());
app.use(cors({ origin: CORS_ORIGINS, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'x-api-key', 'X-Request-ID'] }));
app.use(express.json({ limit: '10kb' }));

// ── Request ID middleware ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  const id = req.headers['x-request-id'] || randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
});

// Issue #519: RFC 7807 problem-details interceptor — normalizes legacy error
// payloads from every handler into a consistent application/problem+json shape.
app.use(createProblemDetailsInterceptor());

// Validation middleware — comprehensive schema validation for all API endpoints (#260)
// Disabled in test mode to avoid breaking existing tests
if (process.env.NODE_ENV !== 'test') {
  app.use(createValidationMiddleware({ strict: false }));
}

// Request logging middleware (silent in test)
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: req => req.url === '/health' },
  genReqId: req => req.requestId,
}));

// ── Rate Limiting Services ─────────────────────────────────────────────────────
const rateLimitAnalytics = new RateLimitAnalytics({ logger });
const anomalyDetector = new AnomalyDetector({ logger });
const geoLimiter = new GeoLimiter({ logger });
const billingService = new BillingService({ logger });

const rateLimiterService = new RateLimiterService({
  logger,
  analytics: rateLimitAnalytics,
  anomalyDetector,
  geoLimiter,
  billingService,
});

// Configure default admin API key with enterprise tier
const adminApiKey = process.env.ADMIN_API_KEY || 'dev-key-change-in-production';
rateLimiterService.configureApiKey(adminApiKey, 'enterprise', {
  email: process.env.ADMIN_EMAIL,
});

const rateLimiter = createRateLimiter(rateLimiterService, {
  onBlocked: (req, res, result) => {
    const body = { error: 'Rate limit exceeded' };
    if (result.reason) body.reason = result.reason;
    if (result.upgradePrompt) body.upgrade = result.upgradePrompt;
    req.log?.warn({ reason: result.reason, apiKey: req.headers['x-api-key']?.slice(0, 8) }, 'Request rate limited');
    return res.status(result.status || 429).json(body);
  },
});

// Apply rate limiter to all API routes (skip admin routes which have their own auth)
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/admin/rate-limits')) return next();
  rateLimiter(req, res, next);
});

// Write limiter for admin write operations (POST/DELETE)
const writeLimiter = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return next();
  const result = await rateLimiterService.checkRateLimit(apiKey, {
    ip: req.ip,
    path: req.path,
    method: req.method,
  });
  if (!result.allowed) {
    return res.status(429).json({ error: 'Too many write requests', reason: result.reason });
  }
  next();
};

// ── OpenAPI / Swagger ──────────────────────────────────────────────────────────
const openapiSpec = generateOpenapiSpec();
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customSiteTitle: 'RWA Marketplace API Docs',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
  },
}));

app.get('/api-docs.json', (_req, res) => {
  res.json(openapiSpec);
});

app.get('/api-docs.yaml', (_req, res) => {
  res.type('text/yaml').send(openapiSpec ? 'To generate YAML, use the JSON endpoint or request with Accept: text/yaml' : '');
});



// ── Routes ────────────────────────────────────────────────────────────────────

// Public sitemap is generated from the current approved asset metadata.
app.get('/sitemap.xml', (req, res) => {
  res.set({
    'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    'Content-Type': 'application/xml; charset=utf-8',
  });
  res.send(buildSitemap(req));
});

/**
 * @openapi
 * /api/admin/verify:
 *   get:
 *     tags: [Admin]
 *     summary: Verify admin API key
 *     description: Returns ok:true if the x-api-key header matches the configured ADMIN_API_KEY. Used for testing authentication.
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: API key is valid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminVerifyResponse'
 *             example:
 *               ok: true
 *       401:
 *         description: Invalid or missing API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: 'Unauthorized: invalid or missing API key'
 */
// Admin API key verification endpoint
app.get('/api/admin/verify', adminAuth, (_req, res) => {
  res.json({ ok: true });
});

// Rate limit admin routes (mounted before the rate limiter that skips them)
const rateLimitAdminRoutes = createRateLimitAdminRoutes(rateLimiterService, adminAuth, {
  analytics: rateLimitAnalytics,
  anomalyDetector,
  geoLimiter,
  billingService,
});
app.use('/api/admin/rate-limits', rateLimitAdminRoutes);

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: System health check
 *     description: Returns overall system status, timestamp, and dependency health (storage, Redis). Returns 503 degraded status if Redis is configured but unreachable.
 *     responses:
 *       200:
 *         description: System is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *       503:
 *         description: System is degraded (dependency failure)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
app.get('/health', async (_req, res) => {
  const deploymentColor = process.env.DEPLOYMENT_COLOR || 'local';
  const serviceName = process.env.SERVICE_NAME || 'backend';
  const buildId = process.env.BUILD_ID || process.env.GITHUB_SHA || 'local';
  const deps = {
    storage: { status: 'ok' },
    redis: { status: 'not_configured' },
  };

  // Check Redis if configured
  if (process.env.REDIS_URL) {
    try {
      const Redis = (await import('ioredis')).default;
      // Reuse the same TLS options as the main cache client so the health
      // check honours REDIS_TLS, REDIS_TLS_CA, REDIS_TLS_CERT, REDIS_TLS_KEY
      // and REDIS_TLS_REJECT_UNAUTHORIZED.
      const tlsOptions = buildTlsOptions();
      const pingClient = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 0,
        ...(tlsOptions && { tls: tlsOptions }),
      });
      await pingClient.connect();
      await pingClient.ping();
      pingClient.disconnect();
      deps.redis = { status: 'ok' };
    } catch {
      deps.redis = { status: 'error', message: 'Redis configured but unreachable' };
      return res.status(503).json({ status: 'degraded', timestamp: new Date().toISOString(), dependencies: deps });
    }
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: {
      name: serviceName,
      deploymentColor,
      buildId,
    },
    dependencies: deps,
  });
});

/**
 * @openapi
 * /api/rwa:
 *   get:
 *     tags: [Assets]
 *     summary: List RWA assets (cursor-based pagination)
 *     description: Returns a paginated list of RWA asset metadata. Supports cursor-based pagination, field-based sorting, asset type filtering, and text search. Results are cached in Redis when available. The default sort is by createdAt descending (most recent first).
 *     parameters:
 *       - in: query
 *         name: after
 *         schema:
 *           type: string
 *         description: Cursor for forward pagination (received from previous response's nextCursor)
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *         description: Cursor for backward pagination (received from previous response's prevCursor)
 *           format: date-time
 *         description: Filter assets created/updated on or before this ISO 8601 date
 *     responses:
 *       200:
 *         description: Exported data file
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 */
v1.get('/rwa/export', adminAuth, (req, res) => {
  const { format = 'json', from, to } = req.query;

  if (!['json', 'csv'].includes(format)) {
    return res.status(400).json({ error: 'format must be "json" or "csv"' });
  }

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (from && isNaN(fromDate)) return res.status(400).json({ error: 'Invalid "from" date' });
  if (to && isNaN(toDate)) return res.status(400).json({ error: 'Invalid "to" date' });

  const data = loadData();
  let assets = Object.entries(data).map(([contractId, meta]) => withCdnAssetUrls({ contractId, ...meta }));

  if (fromDate) assets = assets.filter(a => new Date(a.updatedAt || a.createdAt) >= fromDate);
  if (toDate)   assets = assets.filter(a => new Date(a.updatedAt || a.createdAt) <= toDate);

  const filename = `rwa-export-${Date.now()}.${format}`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  if (format === 'csv') {
    const cols = ['contractId', 'id', 'title', 'location', 'description', 'assetType', 'imageUrl', 'totalValuation', 'createdAt', 'updatedAt'];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [cols.join(','), ...assets.map(a => cols.map(c => escape(a[c])).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(rows.join('\r\n'));
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(assets);
});

/**
 * @openapi
 * /api/v1/rwa:
 *   get:
 *     tags: [Assets]
 *     summary: List all asset metadata
 *     description: Returns a paginated, filterable list of all RWA assets.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Maximum number of items per page
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [createdAt, title, contractId, assetType, updatedAt, totalValuation]
 *           default: createdAt
 *         description: Field to sort by
 *         description: Full-text search on title and description
 *         example: luxury
 *     responses:
 *       200:
 *         description: Paginated list of assets
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedAssets'
 */
v1.get('/rwa', (req, res) => {
  const data = loadData();
  let assets = Object.entries(data)
    .filter(([, meta]) => isApproved(meta))
    .map(([contractId, meta]) => withCdnAssetUrls({ contractId, ...meta }));

  // Filter: assetType (case-insensitive) — faceted filter
  const { assetType, location, search, page, limit } = req.query;
  if (assetType) {
    const lower = assetType.toLowerCase();
    assets = assets.filter(a => a.assetType?.toLowerCase() === lower);
  }

  // Filter: location (faceted filter)
  if (location) {
    const lower = location.toLowerCase();
    assets = assets.filter(a => a.location?.toLowerCase().includes(lower));
  }

  // Filter: full-text search with relevance scoring on title, description, location
  if (search) {
    const approvedData = Object.fromEntries(
      Object.entries(data).filter(([, m]) => isApproved(m))
    );
    // Rebuild index scoped to approved assets for accurate IDF
    buildSearchIndex(approvedData);
    const ranked = scoreSearch(search, approvedData);
    const rankedIds = new Set(ranked.map(r => r.contractId));
    // Preserve relevance order
    const byId = Object.fromEntries(assets.map(a => [a.contractId, a]));
    assets = ranked
      .filter(r => rankedIds.has(r.contractId) && byId[r.contractId])
      .map(r => ({ ...byId[r.contractId], _score: r.score }));
  }

  const total = assets.length;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const totalPages = Math.ceil(total / pageSize) || 1;
  const offset = (pageNum - 1) * pageSize;

    const paginationParams = parsePaginationParams(req);
    const result = applyCursorPagination(assets, paginationParams);

    res.json(result);

    // Cache the asset list result (fire-and-forget)
    cacheSet('rwa:all', result).catch(() => {});
});

/**
 * @openapi
 * /api/v1/rwa/search:
 *   get:
 *     tags: [Assets]
 *     summary: Full-text search with relevance scoring
 *     description: Search assets by query across title, description, and location with TF-IDF relevance scoring and faceted filters.
 *     parameters:
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort direction (defaults per field; createdAt desc, title asc, etc.)
 *       - in: query
 *         name: assetType
 *         schema:
 *           type: string
 *         description: Filter by asset type (case-insensitive exact match)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for case-insensitive matching against title and description
 *     responses:
 *       200:
 *         description: Paginated list of assets
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedAssetList'
 *       400:
 *         description: Invalid cursor or pagination parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
app.get('/api/rwa', (req, res, next) => {
  try {
    const data = loadData();
    const assets = Object.entries(data).map(([contractId, meta]) => ({ contractId, ...meta }));

    const paginationParams = parsePaginationParams(req);
    const result = applyCursorPagination(assets, paginationParams);

    res.json(result);

    // Cache the asset list result (fire-and-forget)
    cacheSet('rwa:all', result).catch(() => {});
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/rwa/{contractId}:
 *   get:
 *     tags: [Assets]
 *     summary: Get single RWA asset metadata
 *     description: Returns metadata for a specific RWA asset by contract ID. Results are cached in Redis (if configured) for subsequent requests.
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 50
 *           pattern: ^C[A-Za-z0-9]+$
 *         description: Stellar contract ID of the asset
 *     responses:
 *       200:
 *         description: Asset metadata
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Asset'
 *       404:
 *         description: Asset not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: 'Asset metadata not found'
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
app.get('/api/rwa/:contractId', async (req, res) => {
  const { contractId } = req.params;

  const cached = await cacheGet(cacheKey(contractId));
  if (cached) return res.json(withCdnAssetUrls(cached));

  const data = loadData();
  const asset = data[contractId];
  if (!asset) return res.status(404).json({ error: 'Asset metadata not found' });
  if (!isApproved(asset)) return res.status(404).json({ error: 'Asset metadata not found' });

  const result = { contractId, ...asset };
  // Cache individual asset (fire-and-forget)
  cacheSet(cacheKey(contractId), result).catch(() => {});
  res.json(withCdnAssetUrls(result));
});

/**
 * @openapi
 * /api/rwa:
 *   post:
 *     tags: [Assets]
 *     summary: Create or update RWA asset metadata
 *     description: Creates a new asset metadata record or updates an existing one. Requires admin authentication. The contractId must be at least 50 characters starting with "C". Required fields: title, location, description, assetType. Invalidates Redis cache on success.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AssetInput'
 *           example:
 *             contractId: 'CCF7LXM6U6H6Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z7Z'
 *             title: 'Luxury Manhattan Condo Unit 12B'
 *             location: 'New York, NY'
 *             description: 'A fully furnished 2-bedroom condo'
 *             assetType: 'real_estate'
 *             imageUrl: 'https://ipfs.io/ipfs/QmX...'
 *             totalValuation: '2500000.00'
 *             documents: ['https://ipfs.io/ipfs/QmY...']
 *     responses:
 *       201:
 *         description: Asset created/updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AssetCreatedResponse'
 *       400:
 *         description: Invalid request body or contract ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Invalid or missing API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded (write limiter)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
app.post('/api/rwa', adminAuth, writeLimiter, async (req, res) => {
  const { contractId, ...metadata } = req.body;

  if (!contractId || !validateContractId(contractId)) {
    return res.status(400).json({ error: 'Invalid contract ID. Must start with C and be at least 50 characters.' });
  }

  const validationError = validateRwaBody(metadata);
  if (validationError) return res.status(400).json({ error: validationError });

  const data = loadData();
  const now = new Date().toISOString();
  data[contractId] = {
    id: metadata.id || contractId,
    title: metadata.title,
    location: metadata.location,
    description: metadata.description,
    assetType: metadata.assetType,
    imageUrl: metadata.imageUrl || '',
    totalValuation: metadata.totalValuation || '',
    documents: Array.isArray(metadata.documents) ? metadata.documents : [],
    status: ASSET_STATUS.PENDING,
    submittedAt: now,
    createdAt: metadata.createdAt || now,
    updatedAt: now,
  };
  saveData(data);

  // Invalidate caches and sync search index (fire-and-forget)
  cacheDel('rwa:all').catch(() => {});
  syncSearchIndex();
  fireWebhooks(WEBHOOK_EVENTS.CREATED, { contractId, ...data[contractId] }).catch(() => {});

  req.log?.info({ contractId }, 'Asset created/updated');
  res.status(201).json(withCdnAssetUrls({ contractId, ...data[contractId] }));
});

/**
 * @openapi
 * /api/rwa/{contractId}:
 *   delete:
 *     tags: [Assets]
 *     summary: Delete RWA asset metadata
 *     description: Deletes an asset metadata record by contract ID. Requires admin authentication. Invalidates Redis cache on success.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 50
 *         description: Stellar contract ID of the asset to delete
 *     responses:
 *       200:
 *         description: Asset deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeleteResponse'
 *       401:
 *         description: Invalid or missing API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Asset not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded (write limiter)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
app.delete('/api/rwa/:contractId', adminAuth, writeLimiter, async (req, res) => {
  const { contractId } = req.params;
  const data = loadData();
  if (!data[contractId]) return res.status(404).json({ error: 'Asset metadata not found' });

  const deleted = { contractId, ...data[contractId] };

  // Unpin all IPFS documents before deleting the asset record.
  // Fire-and-forget — we don't block the response on Pinata's API.
  if (Array.isArray(deleted.documents) && deleted.documents.length > 0) {
    Promise.allSettled(
      deleted.documents
        .filter(d => d.cid)
        .map(d => unpinFromIPFS(d.cid))
    ).then(results => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          logger.warn({ cid: deleted.documents[i].cid, err: r.reason }, 'Failed to unpin document');
        }
      });
    });
  }

  delete data[contractId];
  saveData(data);

  // Invalidate caches and sync search index (fire-and-forget)
  cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
  syncSearchIndex();
  fireWebhooks(WEBHOOK_EVENTS.DELETED, deleted).catch(() => {});

  req.log?.info({ contractId }, 'Asset deleted');
  res.json({ message: 'Asset metadata deleted', contractId });
});

// Cursor pagination error handler
app.use(paginationErrorHandler);
/**
 * @openapi
 * /api/v1/rwa/{contractId}:
 *   patch:
 *     tags: [Assets]
 *     summary: Partially update asset metadata
 *     description: Update only the provided fields. Requires admin API key via `x-api-key` header.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *         description: Soroban contract ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               location:
 *                 type: string
 *               description:
 *                 type: string
 *               assetType:
 *                 type: string
 *               imageUrl:
 *                 type: string
 *               totalValuation:
 *                 type: string
 *               documents:
 *                 type: array
 *                 items:
 *                   type: object
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: Asset updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Asset'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Asset not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
v1.patch('/rwa/:contractId', adminAuth, writeLimiter, async (req, res) => {
  const { contractId } = req.params;
  const patch = req.body;

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'Request body must contain at least one field to update' });
  }

  const data = loadData();
  if (!data[contractId]) return res.status(404).json({ error: 'Asset metadata not found' });

  // Merge only provided fields
  const allowedFields = ['title', 'location', 'description', 'assetType', 'imageUrl', 'totalValuation', 'documents'];
  allowedFields.forEach(field => {
    if (field in patch && patch[field] !== undefined) {
      data[contractId][field] = patch[field];
    }
  });

  data[contractId].updatedAt = new Date().toISOString();
  saveData(data);

  // Invalidate caches and sync search index (fire-and-forget)
  cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
  syncSearchIndex();
  fireWebhooks(WEBHOOK_EVENTS.UPDATED, { contractId, ...data[contractId] }).catch(() => {});

  req.log?.info({ contractId, fields: Object.keys(patch) }, 'Asset partially updated');
  res.json(withCdnAssetUrls({ contractId, ...data[contractId] }));
});

/**
 * backend/index.js — backward-compatibility shim.
 *
 * The application has been split into the src/ directory (issue #122).
 * This file re-exports the public API so that existing tests and any
 * external tooling that imports from `index.js` continues to work unchanged.
 *
 * New code should import directly from the relevant src/ module.
 */
v1.post('/rwa/:contractId/documents', adminAuth, writeLimiter, upload.single('document'), async (req, res) => {
  const { contractId } = req.params;

  // multer puts the uploaded file on req.file
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Send a multipart/form-data request with field name "document".' });
  }

  const data = loadData();
  if (!data[contractId]) {
    return res.status(404).json({ error: 'Asset metadata not found' });
  }

  try {
    // Upload the buffer directly to Pinata — no disk writes
    const { cid, url, name } = await uploadToIPFS(
      req.file.buffer,
      req.file.originalname,
      data[contractId].title || contractId
    );

    // Store the document entry in the asset's documents array
    const docEntry = {
      cid,
      url,
      name,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
    };

    if (!Array.isArray(data[contractId].documents)) {
      data[contractId].documents = [];
    }
    data[contractId].documents.push(docEntry);
    data[contractId].updatedAt = new Date().toISOString();
    saveData(data);

    // Bust the cache so the updated asset is returned immediately
    cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});

    req.log?.info({ contractId, cid }, 'Document uploaded to IPFS');
    res.json({ contractId, document: docEntry, documents: data[contractId].documents });

  } catch (err) {
    req.log?.error({ err, contractId }, 'IPFS upload failed');
    res.status(502).json({ error: `IPFS upload failed: ${err.message}` });
  }
});

/**
 * @openapi
 * /api/v1/rwa/{contractId}/documents/{cid}:
 *   get:
 *     tags: [Assets]
 *     summary: Retrieve a document from IPFS by CID
 *     description: Redirects to the IPFS gateway URL for the given CID.
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: cid
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirect to IPFS gateway URL
 *       404:
 *         description: Asset or document not found
 */
v1.get('/rwa/:contractId/documents/:cid', async (req, res) => {
  const { contractId, cid } = req.params;

  const data = loadData();
  const asset = data[contractId];
  if (!asset) {
    return res.status(404).json({ error: 'Asset metadata not found' });
  }

  // Verify this CID actually belongs to this asset before redirecting
  const doc = asset.documents?.find(d => d.cid === cid);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found on this asset' });
  }

  // Redirect to the IPFS gateway — the file is served from IPFS, not our server
  const url = getIPFSFileUrl(cid);
  req.log?.info({ contractId, cid, url }, 'Redirecting to IPFS document');
  res.redirect(302, url);
});

/**
 * @openapi
 * /api/v1/rwa/{contractId}/approve:
 *   post:
 *     tags: [Assets]
 *     summary: Approve a pending asset
 *     description: Sets asset status to "approved". Requires admin API key.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *         description: Soroban contract ID
 *     responses:
 *       200:
 *         description: Asset approved
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Asset not found
 */
v1.post('/rwa/:contractId/approve', adminAuth, writeLimiter, async (req, res) => {
  const { contractId } = req.params;
  const data = loadData();
  if (!data[contractId]) return res.status(404).json({ error: 'Asset metadata not found' });

  data[contractId].status = ASSET_STATUS.APPROVED;
  data[contractId].reviewedAt = new Date().toISOString();
  data[contractId].reviewedBy = req.headers['x-reviewer'] || 'admin';
  data[contractId].updatedAt = new Date().toISOString();
  saveData(data);

  cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
  fireWebhooks(WEBHOOK_EVENTS.APPROVED, { contractId, ...data[contractId] }).catch(() => {});
  req.log?.info({ contractId }, 'Asset approved');
  res.json(withCdnAssetUrls({ contractId, ...data[contractId] }));
});

/**
 * @openapi
 * /api/v1/rwa/{contractId}/reject:
 *   post:
 *     tags: [Assets]
 *     summary: Reject a pending asset
 *     description: Sets asset status to "rejected". Requires admin API key.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *         description: Soroban contract ID
 *     responses:
 *       200:
 *         description: Asset rejected
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Asset not found
 */
v1.post('/rwa/:contractId/reject', adminAuth, writeLimiter, async (req, res) => {
  const { contractId } = req.params;
  const data = loadData();
  if (!data[contractId]) return res.status(404).json({ error: 'Asset metadata not found' });

  data[contractId].status = ASSET_STATUS.REJECTED;
  data[contractId].reviewedAt = new Date().toISOString();
  data[contractId].reviewedBy = req.headers['x-reviewer'] || 'admin';
  data[contractId].updatedAt = new Date().toISOString();
  saveData(data);

  cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
  fireWebhooks(WEBHOOK_EVENTS.REJECTED, { contractId, ...data[contractId] }).catch(() => {});
  req.log?.info({ contractId }, 'Asset rejected');
  res.json(withCdnAssetUrls({ contractId, ...data[contractId] }));
});

// ── News / Updates ────────────────────────────────────────────────────────────
const NEWS_STORAGE = [
  {
    id: '1',
    title: 'Platform Launch',
    summary: 'The RWA Marketplace is now live on Stellar Testnet. Start exploring tokenized real-world assets.',
    date: new Date().toISOString(),
    link: 'https://github.com/Trust-Analysis/Tokenized-Fractional-',
  },
  {
    id: '2',
    title: 'New Asset Listings',
    summary: 'Multiple new real estate and asset-backed tokens are now available for purchase in the marketplace.',
    date: new Date(Date.now() - 86400000 * 2).toISOString(),
    link: '#',
  },
];

/**
 * @openapi
 * /api/v1/news:
 *   get:
 *     tags: [News]
 *     summary: List marketplace news and updates
 *     description: Returns a list of announcements, new listings, and platform updates.
 *     responses:
 *       200:
 *         description: Array of news items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   title:
 *                     type: string
 *                   summary:
 *                     type: string
 *                   date:
 *                     type: string
 *                     format: date-time
 *                   link:
 *                     type: string
 */
v1.get('/news', (_req, res) => {
  res.json(NEWS_STORAGE);
});

// ── Webhook CRUD routes (admin only) ──────────────────────────────────────────
/**
 * @openapi
 * /api/v1/webhooks:
 *   get:
 *     tags: [Webhooks]
 *     summary: List all webhooks (admin only)
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of registered webhooks
 *       401:
 *         description: Unauthorized
 */
v1.get('/webhooks', adminAuth, (req, res) => {
  const webhooks = loadWebhooks();
  res.json(Object.values(webhooks));
});

/**
 * @openapi
 * /api/v1/webhooks:
 *   post:
 *     tags: [Webhooks]
 *     summary: Register a new webhook (admin only)
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WebhookInput'
 *     responses:
 *       201:
 *         description: Webhook created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
v1.post('/webhooks', adminAuth, writeLimiter, (req, res) => {
  const error = validateWebhookBody(req.body);
  if (error) return res.status(400).json({ error });

  const id = generateWebhookId();
  const now = new Date().toISOString();
  const webhooks = loadWebhooks();
  webhooks[id] = {
    id,
    url: req.body.url,
    events: req.body.events,
    secret: req.body.secret || '',
    active: req.body.active !== false,
    createdAt: now,
    updatedAt: now,
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
  };
  saveWebhooks(webhooks);

  req.log?.info({ webhookId: id, url: req.body.url }, 'Webhook created');
  res.status(201).json(webhooks[id]);
});

/**
 * @openapi
 * /api/v1/webhooks/{id}:
 *   get:
 *     tags: [Webhooks]
 *     summary: Get a webhook by ID (admin only)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Webhook details
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Webhook not found
 */
v1.get('/webhooks/:id', adminAuth, (req, res) => {
  const webhooks = loadWebhooks();
  const wh = webhooks[req.params.id];
  if (!wh) return res.status(404).json({ error: 'Webhook not found' });
  res.json(wh);
});

/**
 * @openapi
 * /api/v1/webhooks/{id}:
 *   patch:
 *     tags: [Webhooks]
 *     summary: Update a webhook (admin only)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WebhookInput'
 *     responses:
 *       200:
 *         description: Webhook updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Webhook not found
 */
v1.patch('/webhooks/:id', adminAuth, writeLimiter, (req, res) => {
  const webhooks = loadWebhooks();
  const wh = webhooks[req.params.id];
  if (!wh) return res.status(404).json({ error: 'Webhook not found' });

  const allowed = ['url', 'events', 'secret', 'active'];
  allowed.forEach(f => {
    if (f in req.body && req.body[f] !== undefined) {
      wh[f] = req.body[f];
    }
  });

  wh.updatedAt = new Date().toISOString();
  saveWebhooks(webhooks);

  req.log?.info({ webhookId: req.params.id }, 'Webhook updated');
  res.json(wh);
});

/**
 * @openapi
 * /api/v1/webhooks/{id}:
 *   delete:
 *     tags: [Webhooks]
 *     summary: Delete a webhook (admin only)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Webhook deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Webhook not found
 */
v1.delete('/webhooks/:id', adminAuth, writeLimiter, (req, res) => {
  const webhooks = loadWebhooks();
  if (!webhooks[req.params.id]) return res.status(404).json({ error: 'Webhook not found' });

  delete webhooks[req.params.id];
  saveWebhooks(webhooks);

  req.log?.info({ webhookId: req.params.id }, 'Webhook deleted');
  res.json({ message: 'Webhook deleted', id: req.params.id });
});

// ── WebSocket Event Broadcasting Routes ────────────────────────────────────────
/**
 * POST /api/v1/notify/share-purchased
 * Broadcasts share purchase events to all connected WebSocket clients
 * Internal use: Called by frontend after successful transaction confirmation
 */
v1.post('/notify/share-purchased', (req, res) => {
  const { contractId, buyerAddress, sharesToBuy, totalCost } = req.body;

  if (!contractId || !buyerAddress || sharesToBuy === undefined || totalCost === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  wsManager.broadcastSharePurchase(contractId, buyerAddress, sharesToBuy, totalCost);

  req.log?.info(
    { contractId, buyerAddress, sharesToBuy, totalCost },
    'Share purchase event broadcasted'
  );

  res.json({ ok: true, message: 'Event broadcasted' });
});

/**
 * POST /api/v1/notify/price-updated
 * Broadcasts price update events to all connected WebSocket clients
 * Internal use: Called by admin when updating price
 */
v1.post('/notify/price-updated', adminAuth, (req, res) => {
  const { contractId, newPrice } = req.body;

  if (!contractId || newPrice === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  wsManager.broadcastPriceUpdate(contractId, newPrice);

  req.log?.info({ contractId, newPrice }, 'Price update event broadcasted');

  res.json({ ok: true, message: 'Event broadcasted' });
});

/**
 * POST /api/v1/notify/availability-changed
 * Broadcasts availability change events to all connected WebSocket clients
 * Internal use: Called when available shares change
 */
v1.post('/notify/availability-changed', adminAuth, (req, res) => {
  const { contractId, availableShares } = req.body;

  if (!contractId || availableShares === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  wsManager.broadcastAvailabilityChange(contractId, availableShares);

  req.log?.info({ contractId, availableShares }, 'Availability change event broadcasted');

  res.json({ ok: true, message: 'Event broadcasted' });
});

/**
 * POST /api/v1/notify/asset-updated
 * Broadcasts asset update events to all connected WebSocket clients
 * Internal use: Called when asset metadata is updated
 */
v1.post('/notify/asset-updated', adminAuth, (req, res) => {
  const { contractId, asset } = req.body;

  if (!contractId || !asset) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  wsManager.broadcastAssetUpdate(contractId, asset);

  req.log?.info({ contractId }, 'Asset update event broadcasted');

  res.json({ ok: true, message: 'Event broadcasted' });
});

/**
 * POST /api/v1/notify/marketplace-status
 * Broadcasts marketplace pause/unpause events to all connected WebSocket clients
 * Internal use: Called by admin when pausing/unpausing marketplace
 */
v1.post('/notify/marketplace-status', adminAuth, (req, res) => {
  const { isPaused } = req.body;

  if (isPaused === undefined) {
    return res.status(400).json({ error: 'Missing isPaused field' });
  }

  wsManager.broadcastMarketplaceStatus(isPaused);

  req.log?.info({ isPaused }, 'Marketplace status event broadcasted');

  res.json({ ok: true, message: 'Event broadcasted' });
});

/**
 * GET /api/v1/ws/stats
 * Returns WebSocket connection statistics
 */
v1.get('/ws/stats', (req, res) => {
  res.json(wsManager.getStats());
});

// ── GraphQL endpoint (Issue #413: deterministic ETag caching) ────────────────
// Mount the GraphQL Yoga server at /api/graphql. A deterministic ETag
// middleware runs first so unchanged vault queries short-circuit to
// `304 Not Modified`, bypassing the resolvers and data-layer reads.
// Issue #464: Tiered rate limiting for GraphQL (100 req/min anon, 1000 req/min auth)
app.use('/api/graphql', createGraphQLRateLimiter());
app.use('/api/graphql', createETagMiddleware({ logger }));
app.use('/api/graphql', yoga);

// Mount versioned router and backward-compatible aliases
app.use('/api/v1', v1);
app.use('/api', v1); // legacy /api/rwa aliased to /api/v1/rwa

// ── Batch API endpoint — multiple operations in a single request (#256) ──────
const batchHandler = createBatchHandler(app, { logger });
app.post('/api/batch', batchHandler);
app.post('/api/v1/batch', batchHandler);

app.use(problemDetailsNotFoundHandler());

// Sentry error handler must be registered before other error handlers
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

app.use(problemDetailsErrorHandler());

export { app, rateLimiterService, rateLimitAnalytics, anomalyDetector, geoLimiter, billingService };

/**
 * Initialize Apollo GraphQL Server
 * Returns a promise that resolves when the server is ready
 */
async function initializeApolloServer(expressApp, httpServer) {
  try {
    // Create data layer object for resolvers
    const dataLayer = {
      loadData,
      saveData,
      validateContractId,
      validateRwaBody,
      scoreSearch,
      syncSearchIndex,
    };

    // Create Apollo Server instance
    const server = new ApolloServer({
      typeDefs,
      resolvers: createResolvers(dataLayer),
      context: ({ req }) => {
        // Check if request has admin API key
        const apiKey = req.headers['x-api-key'];
        const isAdmin = apiKey === process.env.ADMIN_API_KEY;
        return { isAdmin, apiKey };
      },
      formatError: (error) => {
        logger.error({ error: error.message, extensions: error.extensions }, 'GraphQL error');
        return {
          message: error.message,
          extensions: {
            code: error.extensions?.code || 'INTERNAL_SERVER_ERROR',
          },
        };
      },
    });

    await server.start();
    logger.info('Apollo Server started');

    // Mount GraphQL middleware at /graphql (Issue #464: Tiered rate limiting)
    expressApp.use('/graphql', createGraphQLRateLimiter());
    expressApp.use(
      '/graphql',
      expressMiddleware(server, {
        context: async ({ req }) => {
          const apiKey = req.headers['x-api-key'];
          const isAdmin = apiKey === process.env.ADMIN_API_KEY;
          return { isAdmin, apiKey };
        },
      })
    );

    logger.info('GraphQL endpoint available at /graphql');

    // Initialize WebSocket subscriptions if httpServer is provided
    if (httpServer) {
      initializeGraphQLSubscriptions(httpServer, server);
      logger.info('GraphQL subscriptions initialized at /graphql/subscriptions');
    }

    return server;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to initialize Apollo Server');
    throw error;
  }
}

if (process.env.NODE_ENV !== 'test') {
  import('./cache.js').then(({ initClient }) => initClient());
  const httpServer = app.listen(PORT, () => {
    logger.info({
      port: PORT,
      rateLimiterTiers: Object.keys(rateLimiterService.getAvailableTiers()).length,
      anomalyDetection: anomalyDetector._enabled,
      geoLimiting: geoLimiter.enabled,
      billing: billingService.enabled,
    }, 'RWA Off-chain Metadata Backend started');

    // Cron job to refresh materialized view (PostgreSQL only)
    setInterval(async () => {
      try {
        const db = getDatabase();
        if (db && db.client.config.client === 'pg') {
          await db.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_historical_vault_metrics');
          logger.info('Materialized view mv_historical_vault_metrics refreshed in background');
        }
      } catch (error) {
        logger.error({ error: error.message }, 'Failed to refresh materialized view');
      }
    }, 60 * 60 * 1000); // 1 hour
  });

  // ── WebSocket server (Issue #593) ──────────────────────────────────────
  // Attach the /ws endpoint and enable cross-instance broadcasting through
  // the Redis Pub/Sub adapter whenever REDIS_URL is configured, so order
  // book / price updates reach clients on every horizontal node.
  wsManager.initialize(httpServer);
  wsManager.connectRedisAdapter();
}
