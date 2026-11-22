/**
 * Backend Integration Example
 * Shows how to use the gateway middleware in your Express app
 */

import express from 'express';
import { logger } from './index.js';

// Import gateway middleware
import {
  authenticate,
  authorize,
  validateApiKey,
  validateJwt,
} from '../gateway/middleware/authentication.js';

import {
  applyDualLimit,
  applyTierLimit,
  applyEndpointLimit,
} from '../gateway/middleware/rateLimiting.js';

import {
  createTransformMiddleware,
  validateSchema,
  standardizeResponse,
  RequestTransformer,
  ResponseTransformer,
} from '../gateway/middleware/requestTransform.js';

import {
  createMonitoringMiddleware,
  createErrorTrackingMiddleware,
  createRequestLogger,
  createHealthCheck,
} from '../gateway/monitoring/observability.js';

import {
  MetricsCollector,
  PrometheusExporter,
  TraceCollector,
} from '../gateway/monitoring/observability.js';

const app = express();

// ────────────────────────────────────────────────────────────────
// Initialize Monitoring
// ────────────────────────────────────────────────────────────────
const metrics = new MetricsCollector({
  namespace: 'RWA-Gateway',
  environment: process.env.ENVIRONMENT || 'production',
});

const prometheus = new PrometheusExporter();
const traces = new TraceCollector();

// ────────────────────────────────────────────────────────────────
// Global Middleware
// ────────────────────────────────────────────────────────────────

// Request logging
app.use(createRequestLogger(logger));

// Monitoring
app.use(createMonitoringMiddleware(metrics, prometheus, logger));

// Response standardization
app.use(standardizeResponse);

// ────────────────────────────────────────────────────────────────
// Metrics Endpoint (for Prometheus)
// ────────────────────────────────────────────────────────────────
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(prometheus.generate());
});

// ────────────────────────────────────────────────────────────────
// Health Check
// ────────────────────────────────────────────────────────────────
app.get('/health', createHealthCheck({
  database: async () => {
    // Check database connectivity
    return { response_time: 5 };
  },
  redis: async () => {
    // Check Redis if configured
    return { response_time: 2 };
  },
  backend: async () => {
    // Check backend service
    return { response_time: 10 };
  },
}));

// ────────────────────────────────────────────────────────────────
// Public Routes (No Authentication)
// ────────────────────────────────────────────────────────────────

// GET /api/rwa - List all RWAs
app.get('/api/rwa', applyEndpointLimit, (req, res) => {
  try {
    const data = loadData(); // Your data loading function
    metrics.recordApiRequest('GET:/api/rwa', 200, 50, JSON.stringify(data).length);
    res.json(data);
  } catch (error) {
    metrics.recordError('GET:/api/rwa', error.constructor.name);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/rwa/{contractId} - Get specific RWA
app.get('/api/rwa/:contractId', applyEndpointLimit, (req, res) => {
  try {
    const { contractId } = req.params;
    const data = loadData();
    const rwa = data[contractId];

    if (!rwa) {
      return res.status(404).json({ error: 'Not Found' });
    }

    metrics.recordApiRequest('GET:/api/rwa/:contractId', 200, 30, JSON.stringify(rwa).length);
    res.json(rwa);
  } catch (error) {
    metrics.recordError('GET:/api/rwa/:contractId', error.constructor.name);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ────────────────────────────────────────────────────────────────
// Protected Routes (Authentication Required)
// ────────────────────────────────────────────────────────────────

// POST /api/rwa - Create new RWA
app.post('/api/rwa',
  authenticate,                // Check authentication
  authorize('write'),          // Check write scope
  applyTierLimit,              // Apply tier-based rate limit
  validateSchema({             // Validate request body
    required: ['title', 'location', 'description', 'assetType'],
    properties: {
      title: { type: 'string', minLength: 3, maxLength: 100 },
      location: { type: 'string', minLength: 3 },
      description: { type: 'string', minLength: 10 },
      assetType: { type: 'string' },
    },
  }),
  (req, res) => {
    try {
      // Your business logic here
      const newRwa = {
        id: generateId(),
        ...req.body,
        createdAt: new Date(),
        createdBy: req.auth.userId,
      };

      const data = loadData();
      data[newRwa.id] = newRwa;
      saveData(data);

      // Log with trace
      const span = {
        spanId: generateId(),
        operation: 'create_rwa',
        duration: 100,
        status: 'ok',
      };
      traces.addSpan(req.requestId, span.spanId, span.operation, span.duration);

      metrics.recordApiRequest('POST:/api/rwa', 201, 100, JSON.stringify(newRwa).length);
      res.status(201).json(newRwa);
    } catch (error) {
      metrics.recordError('POST:/api/rwa', error.constructor.name);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

// DELETE /api/rwa/{contractId} - Delete RWA
app.delete('/api/rwa/:contractId',
  authenticate,                // Check authentication
  authorize('admin'),          // Check admin scope
  applyTierLimit,              // Apply tier-based rate limit
  (req, res) => {
    try {
      const { contractId } = req.params;

      // Validate contract ID format
      if (!/^C[A-Za-z0-9]{49,}$/.test(contractId)) {
        return res.status(400).json({ error: 'Invalid contract ID format' });
      }

      const data = loadData();

      if (!data[contractId]) {
        return res.status(404).json({ error: 'Not Found' });
      }

      delete data[contractId];
      saveData(data);

      metrics.recordApiRequest('DELETE:/api/rwa/:contractId', 204, 80, 0);
      res.status(204).send();
    } catch (error) {
      metrics.recordError('DELETE:/api/rwa/:contractId', error.constructor.name);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

// ────────────────────────────────────────────────────────────────
// Admin Routes (API Key Only)
// ────────────────────────────────────────────────────────────────

// GET /api/admin/stats - Get admin statistics
app.get('/api/admin/stats',
  validateApiKey,              // API key required
  (req, res) => {
    try {
      const data = loadData();
      const stats = {
        totalRwas: Object.keys(data).length,
        lastUpdated: new Date(),
      };

      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

// ────────────────────────────────────────────────────────────────
// Error Handling
// ────────────────────────────────────────────────────────────────

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use(createErrorTrackingMiddleware(metrics, logger));

// ────────────────────────────────────────────────────────────────
// Graceful Shutdown
// ────────────────────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, flushing metrics...');
  await metrics.flush();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, flushing metrics...');
  await metrics.flush();
  process.exit(0);
});

export default app;

// ────────────────────────────────────────────────────────────────
// Usage Examples
// ────────────────────────────────────────────────────────────────

/*

1. AUTHENTICATE WITH API KEY
   curl -H "X-API-Key: your-api-key" http://localhost:3001/api/rwa

2. AUTHENTICATE WITH JWT
   curl -H "Authorization: Bearer eyJhbGc..." http://localhost:3001/api/rwa

3. CREATE RWA (requires authentication)
   curl -X POST \
     -H "Content-Type: application/json" \
     -H "X-API-Key: your-api-key" \
     -d '{
       "title": "Real Estate Property",
       "location": "New York",
       "description": "Premium commercial property",
       "assetType": "RealEstate"
     }' \
     http://localhost:3001/api/rwa

4. GET METRICS
   curl http://localhost:3001/metrics

5. HEALTH CHECK
   curl http://localhost:3001/health

6. ADMIN STATS (API key required)
   curl -H "X-API-Key: your-api-key" http://localhost:3001/api/admin/stats

*/
