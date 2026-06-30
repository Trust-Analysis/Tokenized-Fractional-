// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/app.js — Express application factory.
 * Creates and configures the app but does NOT start the HTTP server.
 * This separation makes the app straightforward to test without binding ports.
 */

import 'dotenv/config';
import { validateEnv } from '../env.js';
validateEnv();

import { randomUUID } from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import * as Sentry from '@sentry/node';
import swaggerUi from 'swagger-ui-express';
import prometheus from 'express-prom-bundle';

import { CORS_ORIGINS, SENTRY_DSN, SENTRY_TRACES_SAMPLE_RATE, SENTRY_PROFILES_SAMPLE_RATE, REDIS_URL, DEPLOYMENT_COLOR, SERVICE_NAME, BUILD_ID, NODE_ENV } from './config.js';
import { logger } from './services/logger.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { createAdminAuth, adminAuth as legacyAdminAuth } from './middleware/auth.js';
import { v1 } from './routes/rwa.js';
import { swaggerSpec } from '../docs.js';
import { initDatabase, getDatabase } from './services/database.js';
import { createApiKeyService } from './services/apiKeyService.js';
import { createApiKeysRouter } from './routes/apiKeys.js';
import { createTransactionService } from './services/transactionService.js';
import { createAnalyticsRoutes } from './routes/analytics.js';
import { createPurchaseRoutes } from './routes/purchases.js';

// ── Sentry init ───────────────────────────────────────────────────────────────
if (SENTRY_DSN && process.env.NODE_ENV !== 'test') {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    profilesSampleRate: SENTRY_PROFILES_SAMPLE_RATE,
    integrations: [
      Sentry.httpIntegration({ breadcrumbs: true }),
      Sentry.expressIntegration(),
    ],
  });
  logger.info({ dsnPrefix: SENTRY_DSN.slice(0, 30) }, 'Sentry initialized');
}

// ── Prometheus metrics ────────────────────────────────────────────────────────
const metricsMiddleware = prometheus({
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  includeUp: true,
  customLabels: { app: 'rwa-backend' },
  promClient: { collectDefaultMetrics: { timeout: 5000 } },
});

// ── App factory ───────────────────────────────────────────────────────────────
export const app = express();

// Store for initialized services
let apiKeyService = null;
let adminAuth = legacyAdminAuth;
let apiKeysRouter = null;
let transactionService = null;
let analyticsRoutes = null;
let purchasesRoutes = null;

/**
 * Initialize the app with database services.
 * Must be called before starting the server.
 */
export async function initializeApp() {
  try {
    // Initialize database
    const db = await initDatabase(NODE_ENV);
    logger.info('Database initialized');

    // Create API key service
    apiKeyService = createApiKeyService(db, logger);

    // Create and bind adminAuth middleware
    adminAuth = createAdminAuth(apiKeyService);
    logger.info('API key service initialized');

    // Setup API keys router
    apiKeysRouter = createApiKeysRouter(apiKeyService, logger);

    // Create transaction service
    transactionService = createTransactionService(db, logger);
    logger.info('Transaction service initialized');

    // Setup analytics and purchases routes
    analyticsRoutes = createAnalyticsRoutes(transactionService, logger, adminAuth);
    purchasesRoutes = createPurchaseRoutes(transactionService, logger);

    return { db, apiKeyService, transactionService };
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to initialize app');
    throw error;
  }
}

// Sentry request handlers must be first
if (SENTRY_DSN) {
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

app.use(helmet());
app.use(cors({
  origin: CORS_ORIGINS,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'X-Request-ID'],
}));
app.use(express.json({ limit: '10kb' }));

// Request-ID middleware
app.use((req, res, next) => {
  const id = req.headers['x-request-id'] || randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
});

// HTTP request logging (silent in test)
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: req => req.url === '/health' },
  genReqId: req => req.requestId,
}));

// Rate limiting for all /api/* routes
app.use('/api/', apiLimiter);

// Prometheus metrics
app.use(metricsMiddleware);
app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', metricsMiddleware.promClient.register.contentType);
  res.send(await metricsMiddleware.promClient.register.metrics());
});

// Swagger docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'RWA Marketplace API Docs',
}));
app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));

// Admin key verification (requires initialization)
app.get('/api/admin/verify', (req, res, next) => adminAuth(req, res, next), (_req, res) => res.json({ ok: true }));

// Health check
app.get('/health', async (_req, res) => {
  const deps = { storage: { status: 'ok' }, redis: { status: 'not_configured' } };

  // Read REDIS_URL at request time so tests can set/unset it dynamically
  const redisUrl = process.env.REDIS_URL || null;
  if (redisUrl) {
    try {
      const Redis = (await import('ioredis')).default;
      const pingClient = new Redis(redisUrl, {
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
    service: { name: SERVICE_NAME, deploymentColor: DEPLOYMENT_COLOR, buildId: BUILD_ID },
    dependencies: deps,
  });
});

// Mount versioned router and backward-compatible alias
app.use('/api/v1', v1);
app.use('/api', v1);

// Mount API key management routes (admin only, after initialization)
app.use('/api/v1/api-keys', (req, res, next) => {
  if (!apiKeysRouter) {
    return res.status(503).json({
      error: 'API key service not initialized',
      code: 'SERVICE_UNAVAILABLE',
    });
  }
  adminAuth(req, res, () => apiKeysRouter(req, res, next));
});

app.use('/api/api-keys', (req, res, next) => {
  if (!apiKeysRouter) {
    return res.status(503).json({
      error: 'API key service not initialized',
      code: 'SERVICE_UNAVAILABLE',
    });
  }
  adminAuth(req, res, () => apiKeysRouter(req, res, next));
});

// Mount analytics routes
app.use('/api/v1/analytics', (req, res, next) => {
  if (!analyticsRoutes) {
    return res.status(503).json({
      error: 'Analytics service not initialized',
      code: 'SERVICE_UNAVAILABLE',
    });
  }
  analyticsRoutes(req, res, next);
});

app.use('/api/analytics', (req, res, next) => {
  if (!analyticsRoutes) {
    return res.status(503).json({
      error: 'Analytics service not initialized',
      code: 'SERVICE_UNAVAILABLE',
    });
  }
  analyticsRoutes(req, res, next);
});

// Mount purchases routes (for recording blockchain transactions)
app.use('/api/v1/purchases', (req, res, next) => {
  if (!purchasesRoutes) {
    return res.status(503).json({
      error: 'Purchase service not initialized',
      code: 'SERVICE_UNAVAILABLE',
    });
  }
  purchasesRoutes(req, res, next);
});

app.use('/api/purchases', (req, res, next) => {
  if (!purchasesRoutes) {
    return res.status(503).json({
      error: 'Purchase service not initialized',
      code: 'SERVICE_UNAVAILABLE',
    });
  }
  purchasesRoutes(req, res, next);
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', requestId: _req.requestId });
});

// Sentry error handler must precede custom error handler
if (SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// Generic error handler
app.use((err, req, res, _next) => {
  req.log?.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
});
