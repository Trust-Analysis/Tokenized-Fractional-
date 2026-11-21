process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-rate-limit-key';
process.env.DATA_FILE = 'test-rate-limit-data.json';
process.env.ANOMALY_DETECTION_ENABLED = 'false';
process.env.GEO_LIMITING_ENABLED = 'false';
process.env.BILLING_INTEGRATION_ENABLED = 'false';
process.env.RATE_LIMIT_ANALYTICS_ENABLED = 'true';

import request from 'supertest';
import { unlinkSync, existsSync } from 'fs';
import { app, rateLimiterService, anomalyDetector } from '../index.js';

const API_KEY = 'test-rate-limit-key';

afterAll(() => {
  rateLimiterService.destroy();
  anomalyDetector.destroy();
  if (existsSync('test-rate-limit-data.json')) unlinkSync('test-rate-limit-data.json');
});

describe('Rate Limiter Service', () => {
  test('configures API key with tier', () => {
    rateLimiterService.configureApiKey('test-free-key', 'free');
    rateLimiterService.configureApiKey('test-premium-key', 'premium');
    rateLimiterService.configureApiKey('test-enterprise-key', 'enterprise');

    expect(rateLimiterService.getTier('test-free-key')).toBe('free');
    expect(rateLimiterService.getTier('test-premium-key')).toBe('premium');
    expect(rateLimiterService.getTier('test-enterprise-key')).toBe('enterprise');
  });

  test('throws on invalid tier', () => {
    expect(() => rateLimiterService.configureApiKey('bad', 'nonexistent')).toThrow(/Invalid tier/);
  });

  test('getAvailableTiers returns all tiers', () => {
    const tiers = rateLimiterService.getAvailableTiers();
    expect(tiers.map(t => t.id)).toEqual(['free', 'premium', 'enterprise']);
  });

  test('getUpgradePath returns next tiers', () => {
    const path = rateLimiterService.getUpgradePath('free');
    expect(path.map(p => p.id)).toEqual(['premium', 'enterprise']);
    expect(rateLimiterService.getUpgradePath('enterprise')).toBeNull();
  });

  test('checkRateLimit allows requests within limit', async () => {
    rateLimiterService.configureApiKey('within-limit', 'free');
    const result = await rateLimiterService.checkRateLimit('within-limit', {});
    expect(result.allowed).toBe(true);
    expect(result.status).toBe(200);
    expect(result.headers['X-RateLimit-Limit']).toBe('100');
    expect(result.headers['X-RateLimit-Tier']).toBe('Free');
  });

  test('checkRateLimit blocks after exceeding limit', async () => {
    rateLimiterService.configureApiKey('over-limit', 'free');

    for (let i = 0; i < 100; i++) {
      await rateLimiterService.checkRateLimit('over-limit', {});
    }

    const result = await rateLimiterService.checkRateLimit('over-limit', {});
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(429);
    expect(result.reason).toBe('rate_limit');
    expect(result.upgradePrompt).toBeDefined();
    expect(result.upgradePrompt.upgradeAvailable).toBe(true);
  });

  test('returns upgrade path in block response', async () => {
    rateLimiterService.configureApiKey('upgrade-test', 'free');
    for (let i = 0; i < 101; i++) {
      await rateLimiterService.checkRateLimit('upgrade-test', {});
    }
    const result = await rateLimiterService.checkRateLimit('upgrade-test', {});
    expect(result.upgradePrompt.tiers).toBeDefined();
    expect(result.upgradePrompt.tiers.length).toBeGreaterThan(0);
    expect(result.upgradePrompt.tiers[0].id).toBe('premium');
  });

  test('premium tier has higher limits', async () => {
    rateLimiterService.configureApiKey('premium-user', 'premium');
    const result = await rateLimiterService.checkRateLimit('premium-user', {});
    expect(result.allowed).toBe(true);
    expect(result.headers['X-RateLimit-Limit']).toBe('1000');
    expect(result.headers['X-RateLimit-Tier']).toBe('Premium');
  });

  test('enterprise tier has highest limits', async () => {
    rateLimiterService.configureApiKey('enterprise-user', 'enterprise');
    const result = await rateLimiterService.checkRateLimit('enterprise-user', {});
    expect(result.allowed).toBe(true);
    expect(result.headers['X-RateLimit-Limit']).toBe('10000');
    expect(result.headers['X-RateLimit-Tier']).toBe('Enterprise');
  });

  test('stats are tracked per key', async () => {
    rateLimiterService.configureApiKey('stats-key', 'free');
    await rateLimiterService.checkRateLimit('stats-key', {});
    const stats = rateLimiterService.getStats('stats-key');
    expect(stats).toBeDefined();
    expect(stats.apiKey).toBe('stats-key');
    expect(stats.tier).toBe('free');
    expect(stats.totalRequests).toBeGreaterThan(0);
  });

  test('getAllStats returns all tracked keys', () => {
    const allStats = rateLimiterService.getAllStats();
    expect(Array.isArray(allStats)).toBe(true);
    expect(allStats.length).toBeGreaterThan(0);
  });

  test('resetKey clears counters', async () => {
    rateLimiterService.configureApiKey('reset-key', 'free');
    await rateLimiterService.checkRateLimit('reset-key', {});
    expect(rateLimiterService.getStats('reset-key')).toBeDefined();
    await rateLimiterService.resetKey('reset-key');
    expect(rateLimiterService.getStats('reset-key')).toBeNull();
  });

  test('updateTierConfig modifies tier settings', () => {
    rateLimiterService.updateTierConfig('free', { maxRequests: 200 });
    const config = rateLimiterService.getTierConfig('free');
    expect(config.maxRequests).toBe(200);
    rateLimiterService.updateTierConfig('free', { maxRequests: 100 });
  });

  test('returns rate limit headers in successful response', async () => {
    rateLimiterService.configureApiKey('headers-test', 'free');
    const result = await rateLimiterService.checkRateLimit('headers-test', {});
    expect(result.headers['X-RateLimit-Limit']).toBeDefined();
    expect(result.headers['X-RateLimit-Remaining']).toBeDefined();
    expect(result.headers['X-RateLimit-Reset']).toBeDefined();
    expect(result.headers['X-RateLimit-Burst-Remaining']).toBeDefined();
    expect(result.headers['X-RateLimit-Tier']).toBeDefined();
    expect(result.headers['X-RateLimit-Concurrent']).toBeDefined();
    expect(result.headers['X-RateLimit-Request-Cost']).toBeDefined();
  });

  test('anomaly detection check passes when disabled', async () => {
    rateLimiterService.configureApiKey('anomaly-key', 'free');
    const result = await rateLimiterService.checkRateLimit('anomaly-key', {
      ip: '1.2.3.4',
      userAgent: 'test-agent',
      path: '/test',
      method: 'GET',
    });
    expect(result.allowed).toBe(true);
  });
});

describe('Rate Limit Admin Routes', () => {
  test('GET /api/admin/rate-limits/stats returns stats', async () => {
    const res = await request(app)
      .get('/api/admin/rate-limits/stats')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/admin/rate-limits/tiers returns tiers', async () => {
    const res = await request(app)
      .get('/api/admin/rate-limits/tiers')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
  });

  test('POST /api/admin/rate-limits/configure configures key', async () => {
    const res = await request(app)
      .post('/api/admin/rate-limits/configure')
      .set('x-api-key', API_KEY)
      .send({ apiKey: 'admin-configured-key', tier: 'premium' });
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('premium');
  });

  test('POST /api/admin/rate-limits/configure rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/admin/rate-limits/configure')
      .set('x-api-key', API_KEY)
      .send({ apiKey: 'no-tier' });
    expect(res.status).toBe(400);
  });

  test('GET /api/admin/rate-limits/stats/:apiKey returns per-key stats', async () => {
    const res = await request(app)
      .get('/api/admin/rate-limits/stats/within-limit')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.data.apiKey).toBe('within-limit');
  });

  test('GET /api/admin/rate-limits/stats/:apiKey returns 404 for unknown key', async () => {
    const res = await request(app)
      .get('/api/admin/rate-limits/stats/unknown-key-12345')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(404);
  });

  test('POST /api/admin/rate-limits/reset/:apiKey resets counters', async () => {
    const res = await request(app)
      .post('/api/admin/rate-limits/reset/reset-key')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
  });

  test('PUT /api/admin/rate-limits/tiers/:tier updates tier config', async () => {
    const res = await request(app)
      .put('/api/admin/rate-limits/tiers/free')
      .set('x-api-key', API_KEY)
      .send({ maxRequests: 150 });
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('free');
    expect(res.body.config.maxRequests).toBe(150);
    rateLimiterService.updateTierConfig('free', { maxRequests: 100 });
  });

  test('GET /api/admin/rate-limits/health returns service status', async () => {
    const res = await request(app)
      .get('/api/admin/rate-limits/health')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.services.rateLimiter).toBeDefined();
    expect(res.body.services.rateLimiter.status).toBe('ok');
  });
});

describe('Rate Limit Analytics', () => {
  test('GET /api/admin/rate-limits/analytics/summary returns summary', async () => {
    const res = await request(app)
      .get('/api/admin/rate-limits/analytics/summary')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.totalRequests).toBeDefined();
  });
});

describe('Rate Limit Anomaly Detector Admin', () => {
  test('GET /api/admin/rate-limits/anomaly/model returns model info', async () => {
    anomalyDetector.enabled = false;
    const res = await request(app)
      .get('/api/admin/rate-limits/anomaly/model')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);
  });
});

describe('Rate Limit Geo Admin', () => {
  test('GET /api/admin/rate-limits/geo/stats returns geo stats', async () => {
    const res = await request(app)
      .get('/api/admin/rate-limits/geo/stats')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});

describe('Rate Limit Middleware (Express integration)', () => {
  test('API routes enforce rate limiting with headers', async () => {
    const res = await request(app)
      .get('/api/rwa')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-tier']).toBeDefined();
  });

  test('returns 429 when rate limit exceeded on route', async () => {
    rateLimiterService.configureApiKey('route-limited-key', 'free');
    for (let i = 0; i < 100; i++) {
      await rateLimiterService.checkRateLimit('route-limited-key', {});
    }
    const res = await request(app)
      .get('/api/rwa')
      .set('x-api-key', 'route-limited-key');
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/rate limit/i);
  });

  test('allows requests without API key (anonymous tier)', async () => {
    const res = await request(app).get('/api/rwa');
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-tier']).toBeDefined();
  });
});
