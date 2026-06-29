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
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import pinoHttp from 'pino-http';
import * as Sentry from '@sentry/node';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setTimeout } from 'timers/promises';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './docs.js';
import { cacheGet, cacheSet, cacheDel } from './cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:4173'];

// ── Logger ────────────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development';
export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  ...(isDev && { transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } } }),
});

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

// Request logging middleware (silent in test)
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: req => req.url === '/health' },
  genReqId: req => req.requestId,
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', apiLimiter);

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please try again later' },
});

// ── API Documentation ──────────────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'RWA Marketplace API Docs',
}));

app.get('/api-docs.json', (_req, res) => {
  res.json(swaggerSpec);
});

// ── Routes ────────────────────────────────────────────────────────────────────

// Admin API key verification endpoint
app.get('/api/admin/verify', adminAuth, (_req, res) => {
  res.json({ ok: true });
});

// ── v1 Router ─────────────────────────────────────────────────────────────────
const v1 = Router();

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
      const pingClient = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 0,
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
 * /api/v1/rwa/export:
 *   get:
 *     tags: [Assets]
 *     summary: Bulk export asset metadata (CSV or JSON)
 *     description: Requires admin API key. Optional date range filter via `from` and `to` (ISO 8601).
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *         description: Export format
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter assets created/updated on or after this ISO 8601 date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
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
  let assets = Object.entries(data).map(([contractId, meta]) => ({ contractId, ...meta }));

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
 *           default: 20
 *         description: Items per page (max 100)
 *       - in: query
 *         name: assetType
 *         schema:
 *           type: string
 *         description: Filter by asset type (case-insensitive)
 *         example: real_estate
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
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
    .map(([contractId, meta]) => ({ contractId, ...meta }));

  // Filter: assetType (case-insensitive)
  const { assetType, search, page, limit } = req.query;
  if (assetType) {
    const lower = assetType.toLowerCase();
    assets = assets.filter(a => a.assetType?.toLowerCase() === lower);
  }

  // Filter: text search on title and description
  if (search) {
    const lower = search.toLowerCase();
    assets = assets.filter(a =>
      a.title?.toLowerCase().includes(lower) ||
      a.description?.toLowerCase().includes(lower)
    );
  }

  const total = assets.length;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const totalPages = Math.ceil(total / pageSize) || 1;
  const offset = (pageNum - 1) * pageSize;

  assets = assets.slice(offset, offset + pageSize);

  res.json({
    data: assets,
    pagination: { total, page: pageNum, limit: pageSize, totalPages },
  });

  // Cache the full asset list (fire-and-forget)
  cacheSet('rwa:all', { data: assets, pagination: { total, page: pageNum, limit: pageSize, totalPages } }).catch(() => {});
});

/**
 * @openapi
 * /api/v1/rwa/pending:
 *   get:
 *     tags: [Assets]
 *     summary: List all pending assets (admin only)
 *     description: Returns all assets with status "pending" that require admin review.
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of pending assets
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Asset'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
v1.get('/rwa/pending', adminAuth, (req, res) => {
  const data = loadData();
  const pending = Object.entries(data)
    .filter(([, meta]) => meta.status === ASSET_STATUS.PENDING)
    .map(([contractId, meta]) => ({ contractId, ...meta }));
  res.json(pending);
});

/**
 * @openapi
 * /api/v1/rwa/{contractId}:
 *   get:
 *     tags: [Assets]
 *     summary: Get asset metadata by contract ID
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *         description: Soroban contract ID
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
 *               $ref: '#/components/schemas/Error'
 */
v1.get('/rwa/:contractId', async (req, res) => {
  const { contractId } = req.params;

  const cached = await cacheGet(cacheKey(contractId));
  if (cached) return res.json(cached);

  const data = loadData();
  const asset = data[contractId];
  if (!asset) return res.status(404).json({ error: 'Asset metadata not found' });
  if (!isApproved(asset)) return res.status(404).json({ error: 'Asset metadata not found' });

  const result = { contractId, ...asset };
  // Cache individual asset (fire-and-forget)
  cacheSet(cacheKey(contractId), result).catch(() => {});
  res.json(result);
});

/**
 * @openapi
 * /api/v1/rwa:
 *   post:
 *     tags: [Assets]
 *     summary: Create or update asset metadata
 *     description: Requires admin API key via `x-api-key` header.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AssetInput'
 *     responses:
 *       201:
 *         description: Asset created or updated
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
 */
v1.post('/rwa', adminAuth, writeLimiter, async (req, res) => {
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

  // Invalidate caches (fire-and-forget)
  cacheDel('rwa:all').catch(() => {});
  fireWebhooks(WEBHOOK_EVENTS.CREATED, { contractId, ...data[contractId] }).catch(() => {});

  req.log?.info({ contractId }, 'Asset created/updated');
  res.status(201).json({ contractId, ...data[contractId] });
});

/**
 * @openapi
 * /api/v1/rwa/{contractId}:
 *   delete:
 *     tags: [Assets]
 *     summary: Delete asset metadata
 *     description: Requires admin API key via `x-api-key` header.
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
 *         description: Asset deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 contractId:
 *                   type: string
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
v1.delete('/rwa/:contractId', adminAuth, writeLimiter, async (req, res) => {
  const { contractId } = req.params;
  const data = loadData();
  if (!data[contractId]) return res.status(404).json({ error: 'Asset metadata not found' });

  const deleted = { contractId, ...data[contractId] };
  delete data[contractId];
  saveData(data);

  // Invalidate caches (fire-and-forget)
  cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
  fireWebhooks(WEBHOOK_EVENTS.DELETED, deleted).catch(() => {});

  req.log?.info({ contractId }, 'Asset deleted');
  res.json({ message: 'Asset metadata deleted', contractId });
});

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

  // Invalidate caches (fire-and-forget)
  cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
  fireWebhooks(WEBHOOK_EVENTS.UPDATED, { contractId, ...data[contractId] }).catch(() => {});

  req.log?.info({ contractId, fields: Object.keys(patch) }, 'Asset partially updated');
  res.json({ contractId, ...data[contractId] });
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
  res.json({ contractId, ...data[contractId] });
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
  res.json({ contractId, ...data[contractId] });
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

// Mount versioned router and backward-compatible aliases
app.use('/api/v1', v1);
app.use('/api', v1); // legacy /api/rwa aliased to /api/v1/rwa

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', requestId: _req.requestId });
});

// Sentry error handler must be registered before other error handlers
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

app.use((err, req, res, _next) => {
  req.log?.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  import('./cache.js').then(({ initClient }) => initClient());
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'RWA Off-chain Metadata Backend started');
  });
}
