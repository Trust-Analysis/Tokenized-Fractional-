// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import 'dotenv/config';
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

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();

// Sentry request handler must be the first middleware
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

app.use(helmet());
app.use(cors({ origin: CORS_ORIGINS, methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Content-Type', 'x-api-key', 'X-Request-ID'] }));
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
  max: 20,
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

  res.json({ status: 'ok', timestamp: new Date().toISOString(), dependencies: deps });
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
  let assets = Object.entries(data).map(([contractId, meta]) => ({ contractId, ...meta }));

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
  data[contractId] = {
    id: metadata.id || contractId,
    title: metadata.title,
    location: metadata.location,
    description: metadata.description,
    assetType: metadata.assetType,
    imageUrl: metadata.imageUrl || '',
    totalValuation: metadata.totalValuation || '',
    documents: Array.isArray(metadata.documents) ? metadata.documents : [],
    createdAt: metadata.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveData(data);

  // Invalidate caches (fire-and-forget)
  cacheDel('rwa:all').catch(() => {});

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

  delete data[contractId];
  saveData(data);

  // Invalidate caches (fire-and-forget)
  cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});

  req.log?.info({ contractId }, 'Asset deleted');
  res.json({ message: 'Asset metadata deleted', contractId });
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
