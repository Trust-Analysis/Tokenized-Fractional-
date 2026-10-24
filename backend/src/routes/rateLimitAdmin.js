import { Router } from 'express';

export function createRateLimitAdminRoutes(rateLimiterService, adminAuth, options = {}) {
  const router = Router();
  const {
    analytics,
    anomalyDetector,
    geoLimiter,
    billingService,
  } = options;

  /**
   * @openapi
   * /api/admin/rate-limits/stats:
   *   get:
   *     tags: [Rate Limiting]
   *     summary: Get all rate limit stats (admin)
   *     description: Returns rate limit usage statistics for all configured API keys. Includes usage counts, tier info, and block status.
   *     security:
   *       - ApiKeyAuth: []
   *     responses:
   *       200:
   *         description: Rate limit stats for all keys
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/RateLimitStatsList'
   *       401:
   *         description: Invalid or missing API key
   *       500:
   *         description: Internal server error
   */
  router.get('/stats', adminAuth, (req, res) => {
    try {
      const allStats = rateLimiterService.getAllStats();
      res.json({
        data: allStats,
        total: allStats.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      req.log?.error({ error: error.message }, 'Failed to get rate limit stats');
      res.status(500).json({ error: 'Failed to get rate limit stats' });
    }
  });

  /**
   * @openapi
   * /api/admin/rate-limits/stats/{apiKey}:
   *   get:
   *     tags: [Rate Limiting]
   *     summary: Get per-key rate limit stats (admin)
   *     description: Returns detailed rate limit usage statistics for a specific API key.
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: apiKey
   *         required: true
   *         schema: { type: string }
   *         description: API key to query
   *     responses:
   *       200:
   *         description: Per-key rate limit stats
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/RateLimitKeyStatsResponse'
   *       401:
   *         description: Invalid or missing API key
   *       404:
   *         description: No stats found for this API key
   *       500:
   *         description: Internal server error
   */
  router.get('/stats/:apiKey', adminAuth, (req, res) => {
    try {
      const stats = rateLimiterService.getStats(req.params.apiKey);
      if (!stats) {
        return res.status(404).json({ error: 'No stats found for this API key' });
      }
      res.json({ data: stats });
    } catch (error) {
      req.log?.error({ error: error.message }, 'Failed to get key stats');
      res.status(500).json({ error: 'Failed to get key stats' });
    }
  });

  /**
   * @openapi
   * /api/admin/rate-limits/tiers:
   *   get:
   *     tags: [Rate Limiting]
   *     summary: Get available rate limit tiers (admin)
   *     description: Returns all configured rate limit tiers and their configurations (limits per time window, burst allowances, etc.).
   *     security:
   *       - ApiKeyAuth: []
   *     responses:
   *       200:
   *         description: Available tiers
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/RateLimitTiers'
   *       401:
   *         description: Invalid or missing API key
   *       500:
   *         description: Internal server error
   */
  router.get('/tiers', adminAuth, (_req, res) => {
    try {
      const tiers = rateLimiterService.getAvailableTiers();
      res.json({ data: tiers });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get tiers' });
    }
  });

  /**
   * @openapi
   * /api/admin/rate-limits/tiers/{tier}:
   *   put:
   *     tags: [Rate Limiting]
   *     summary: Update tier configuration (admin)
   *     description: Updates the configuration for a specific rate limit tier. Accepts partial updates.
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: tier
   *         required: true
   *         schema: { type: string }
   *         description: Tier name to update
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/TierUpdateRequest'
   *     responses:
   *       200:
   *         description: Tier updated
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TierUpdateResponse'
   *       400:
   *         description: Invalid configuration
   *       401:
   *         description: Invalid or missing API key
   *       500:
   *         description: Internal server error
   */
  router.put('/tiers/:tier', adminAuth, (req, res) => {
    try {
      const { tier } = req.params;
      const config = req.body;

      rateLimiterService.updateTierConfig(tier, config);
      res.json({
        message: `Tier '${tier}' configuration updated`,
        tier,
        config: rateLimiterService.getTierConfig(tier),
      });
    } catch (error) {
      req.log?.error({ error: error.message }, 'Failed to update tier');
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * @openapi
   * /api/admin/rate-limits/configure:
   *   post:
   *     tags: [Rate Limiting]
   *     summary: Configure API key rate limits (admin)
   *     description: Assigns a rate limit tier to an API key. Optionally creates a billing subscription if billing service is enabled.
   *     security:
   *       - ApiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/KeyConfigureRequest'
   *     responses:
   *       200:
   *         description: API key configured
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/KeyConfigureResponse'
   *       400:
   *         description: Missing required fields (apiKey, tier)
   *       401:
   *         description: Invalid or missing API key
   *       500:
   *         description: Internal server error
   */
  router.post('/configure', adminAuth, (req, res) => {
    try {
      const { apiKey, tier, ...rest } = req.body;

      if (!apiKey || !tier) {
        return res.status(400).json({ error: 'apiKey and tier are required' });
      }

      rateLimiterService.configureApiKey(apiKey, tier, rest);

      if (billingService) {
        billingService.createSubscription(apiKey, tier, rest).catch(() => {});
      }

      req.log?.info({ apiKey: apiKey.slice(0, 8) + '...', tier }, 'API key rate limit configured');
      res.json({ message: 'API key configured', apiKey: apiKey.slice(0, 8) + '...', tier });
    } catch (error) {
      req.log?.error({ error: error.message }, 'Failed to configure API key');
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * @openapi
   * /api/admin/rate-limits/reset/{apiKey}:
   *   post:
   *     tags: [Rate Limiting]
   *     summary: Reset rate limit counters (admin)
   *     description: Resets all rate limit counters for a specific API key, effectively giving them a fresh start.
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: apiKey
   *         required: true
   *         schema: { type: string }
   *         description: API key whose counters should be reset
   *     responses:
   *       200:
   *         description: Counters reset
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/KeyResetResponse'
   *       401:
   *         description: Invalid or missing API key
   *       500:
   *         description: Internal server error
   */
  router.post('/reset/:apiKey', adminAuth, async (req, res) => {
    try {
      await rateLimiterService.resetKey(req.params.apiKey);
      res.json({ message: 'Rate limit counters reset', apiKey: req.params.apiKey.slice(0, 8) + '...' });
    } catch (error) {
      req.log?.error({ error: error.message }, 'Failed to reset key');
      res.status(500).json({ error: 'Failed to reset rate limit counters' });
    }
  });

  if (analytics) {
    /**
     * @openapi
     * /api/admin/rate-limits/analytics/summary:
     *   get:
     *     tags: [Rate Limiting]
     *     summary: Get rate limit analytics summary (admin)
     *     description: Returns a summary of rate limit analytics including usage patterns, peak times, and key metrics.
     *     security:
     *       - ApiKeyAuth: []
     *     responses:
     *       200:
     *         description: Analytics summary
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AnalyticsSummaryResponse'
     *       401:
     *         description: Invalid or missing API key
     *       500:
     *         description: Internal server error
     */
    router.get('/analytics/summary', adminAuth, (_req, res) => {
      try {
        const summary = analytics.getSummary();
        res.json({ data: summary });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get analytics summary' });
      }
    });

    /**
     * @openapi
     * /api/admin/rate-limits/analytics/export:
     *   get:
     *     tags: [Rate Limiting]
     *     summary: Export analytics data (admin)
     *     description: Exports rate limit analytics data with optional date range and format filters.
     *     security:
     *       - ApiKeyAuth: []
     *     parameters:
     *       - in: query
     *         name: from
     *         schema: { type: string }
     *         description: Start date
     *       - in: query
     *         name: to
     *         schema: { type: string }
     *         description: End date
     *       - in: query
     *         name: format
     *         schema: { type: string }
     *         description: Export format
     *     responses:
     *       200:
     *         description: Exported analytics data
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AnalyticsExportResponse'
     *       401:
     *         description: Invalid or missing API key
     *       500:
     *         description: Internal server error
     */
    router.get('/analytics/export', adminAuth, (req, res) => {
      try {
        const { from, to, format } = req.query;
        const data = analytics.exportData({ from, to, format });
        res.json({ data });
      } catch (error) {
        res.status(500).json({ error: 'Failed to export analytics' });
      }
    });

    /**
     * @openapi
     * /api/admin/rate-limits/analytics/key/{apiKey}:
     *   get:
     *     tags: [Rate Limiting]
     *     summary: Get per-key analytics (admin)
     *     description: Returns detailed rate limit analytics for a specific API key.
     *     security:
     *       - ApiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: apiKey
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Per-key analytics
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AnalyticsKeyResponse'
     *       401:
     *         description: Invalid or missing API key
     *       500:
     *         description: Internal server error
     */
    router.get('/analytics/key/:apiKey', adminAuth, (req, res) => {
      try {
        const stats = analytics.getDetailedStats(req.params.apiKey);
        res.json({ data: stats });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get key analytics' });
      }
    });
  }

  if (anomalyDetector) {
    /**
     * @openapi
     * /api/admin/rate-limits/anomaly/model:
     *   get:
     *     tags: [Rate Limiting]
     *     summary: Get anomaly detection model info (admin)
     *     description: Returns current anomaly detection model configuration and statistics.
     *     security:
     *       - ApiKeyAuth: []
     *     responses:
     *       200:
     *         description: Model info
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AnomalyModelResponse'
     *       401:
     *         description: Invalid or missing API key
     *       500:
     *         description: Internal server error
     */
    router.get('/anomaly/model', adminAuth, (_req, res) => {
      try {
        const modelInfo = anomalyDetector.getModelInfo();
        res.json({ data: modelInfo });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get model info' });
      }
    });

    /**
     * @openapi
     * /api/admin/rate-limits/anomaly/train:
     *   post:
     *     tags: [Rate Limiting]
     *     summary: Train anomaly detection model (admin)
     *     description: Trains the anomaly detection model with provided data.
     *     security:
     *       - ApiKeyAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/AnomalyTrainRequest'
     *     responses:
     *       200:
     *         description: Model trained
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AnomalyModelResponse'
     *       401:
     *         description: Invalid or missing API key
     *       500:
     *         description: Internal server error
     */
    router.post('/anomaly/train', adminAuth, async (req, res) => {
      try {
        const result = await anomalyDetector.train(req.body.data);
        res.json({ data: result });
      } catch (error) {
        res.status(500).json({ error: 'Failed to train model' });
      }
    });

    /**
     * @openapi
     * /api/admin/rate-limits/anomaly/config:
     *   put:
     *     tags: [Rate Limiting]
     *     summary: Configure anomaly detector (admin)
     *     description: Updates anomaly detector parameters (burstThreshold, timeWindowMs, confidenceThreshold).
     *     security:
     *       - ApiKeyAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               burstThreshold: { type: integer }
     *               timeWindowMs: { type: integer }
     *               confidenceThreshold: { type: number }
     *     responses:
     *       200:
     *         description: Anomaly detector configured
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AnomalyConfigResponse'
     *       401:
     *         description: Invalid or missing API key
     *       500:
     *         description: Internal server error
     */
    router.put('/anomaly/config', adminAuth, (req, res) => {
      try {
        const { burstThreshold, timeWindowMs, confidenceThreshold } = req.body;
        if (burstThreshold) anomalyDetector.burstThreshold = burstThreshold;
        if (timeWindowMs) anomalyDetector.timeWindowMs = timeWindowMs;
        if (confidenceThreshold) anomalyDetector.confidenceThreshold = confidenceThreshold;
        res.json({ message: 'Anomaly detector configured', config: anomalyDetector.getModelInfo() });
      } catch (error) {
        res.status(500).json({ error: 'Failed to configure anomaly detector' });
      }
    });
  }

  if (geoLimiter) {
    /**
     * @openapi
     * /api/admin/rate-limits/geo/stats:
     *   get:
     *     tags: [Rate Limiting]
     *     summary: Get geo statistics (admin)
     *     description: Returns per-country rate limit usage statistics.
     *     security:
     *       - ApiKeyAuth: []
     *     responses:
     *       200:
     *         description: Geo stats
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/GeoStatsResponse'
     *       401:
     *         description: Invalid or missing API key
     *       500:
     *         description: Internal server error
     */
    router.get('/geo/stats', adminAuth, (_req, res) => {
      try {
        const stats = geoLimiter.getCountryStats();
        res.json({ data: stats });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get geo stats' });
      }
    });

    /**
     * @openapi
     * /api/admin/rate-limits/geo/block:
     *   post:
     *     tags: [Rate Limiting]
     *     summary: Block a country (admin)
     *     description: Adds a country to the blocked list. All requests from this country will be denied.
     *     security:
     *       - ApiKeyAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/GeoBlockRequest'
     *     responses:
     *       200:
     *         description: Country blocked
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/GeoActionResponse'
     *       400:
     *         description: Missing country code
     *       401:
     *         description: Invalid or missing API key
     *       500:
     *         description: Internal server error
     */
    router.post('/geo/block', adminAuth, (req, res) => {
      try {
        const { country } = req.body;
        if (!country) return res.status(400).json({ error: 'country is required' });
        geoLimiter.blockedCountries.add(country.toUpperCase());
        res.json({ message: `Country ${country.toUpperCase()} blocked` });
      } catch (error) {
        res.status(500).json({ error: 'Failed to block country' });
      }
    });

    /**
     * @openapi
     * /api/admin/rate-limits/geo/unblock:
     *   post:
     *     tags: [Rate Limiting]
     *     summary: Unblock a country (admin)
     *     description: Removes a country from the blocked list.
     *     security:
     *       - ApiKeyAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/GeoBlockRequest'
     *     responses:
     *       200:
     *         description: Country unblocked
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/GeoActionResponse'
     *       400:
     *         description: Missing country code
     *       401:
     *         description: Invalid or missing API key
     *       500:
     *         description: Internal server error
     */
    router.post('/geo/unblock', adminAuth, (req, res) => {
      try {
        const { country } = req.body;
        if (!country) return res.status(400).json({ error: 'country is required' });
        geoLimiter.blockedCountries.delete(country.toUpperCase());
        res.json({ message: `Country ${country.toUpperCase()} unblocked` });
      } catch (error) {
        res.status(500).json({ error: 'Failed to unblock country' });
      }
    });

    /**
     * @openapi
     * /api/admin/rate-limits/geo/restrict:
     *   post:
     *     tags: [Rate Limiting]
     *     summary: Restrict a country's rate limit (admin)
     *     description: Sets a custom rate limit for a specific country.
     *     security:
     *       - ApiKeyAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/GeoRestrictRequest'
     *     responses:
     *       200:
     *         description: Country restricted
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/GeoActionResponse'
     *       400:
     *         description: Missing country or limit
     *       401:
     *         description: Invalid or missing API key
     *       500:
     *         description: Internal server error
     */
    router.post('/geo/restrict', adminAuth, (req, res) => {
      try {
        const { country, limit } = req.body;
        if (!country || !limit) return res.status(400).json({ error: 'country and limit are required' });
        geoLimiter.restrictedCountries.set(country.toUpperCase(), parseInt(limit));
        res.json({ message: `Country ${country.toUpperCase()} restricted to ${limit} req/hr` });
      } catch (error) {
        res.status(500).json({ error: 'Failed to restrict country' });
      }
    });
  }

  if (billingService) {
    /**
     * @openapi
     * /api/admin/rate-limits/billing/subscription/{apiKey}:
     *   get:
     *     tags: [Rate Limiting]
     *     summary: Get billing subscription (admin)
     *     description: Returns subscription details for a specific API key.
     *     security:
     *       - ApiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: apiKey
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Subscription details
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/BillingSubscriptionResponse'
     *       401:
     *         description: Invalid or missing API key
     *       404:
     *         description: No subscription found
     *       500:
     *         description: Internal server error
     */
    router.get('/billing/subscription/:apiKey', adminAuth, (req, res) => {
      try {
        const sub = billingService.getSubscription(req.params.apiKey);
        if (!sub) return res.status(404).json({ error: 'No subscription found' });
        res.json({ data: sub });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get subscription' });
      }
    });

    /**
     * @openapi
     * /api/admin/rate-limits/billing/upgrade:
     *   post:
     *     tags: [Rate Limiting]
     *     summary: Upgrade subscription (admin)
     *     description: Upgrades an existing subscription to a higher tier.
     *     security:
     *       - ApiKeyAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/BillingUpgradeRequest'
     *     responses:
     *       200:
     *         description: Subscription upgraded
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/BillingUpgradeResponse'
     *       400:
     *         description: Missing apiKey or tier
     *       401:
     *         description: Invalid or missing API key
     *       500:
     *         description: Internal server error
     */
    router.post('/billing/upgrade', adminAuth, async (req, res) => {
      try {
        const { apiKey, tier } = req.body;
        if (!apiKey || !tier) return res.status(400).json({ error: 'apiKey and tier are required' });

        const sub = await billingService.upgradeSubscription(apiKey, tier);
        rateLimiterService.configureApiKey(apiKey, tier);

        res.json({ message: 'Subscription upgraded', data: sub });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    /**
     * @openapi
     * /api/admin/rate-limits/billing/cancel:
     *   post:
     *     tags: [Rate Limiting]
     *     summary: Cancel subscription (admin)
     *     description: Cancels an existing billing subscription for an API key.
     *     security:
     *       - ApiKeyAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/BillingCancelRequest'
     *     responses:
     *       200:
     *         description: Subscription cancelled
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/BillingCancelResponse'
     *       400:
     *         description: Missing apiKey
     *       401:
     *         description: Invalid or missing API key
     *       404:
     *         description: No subscription found
     *       500:
     *         description: Internal server error
     */
    router.post('/billing/cancel', adminAuth, async (req, res) => {
      try {
        const { apiKey } = req.body;
        if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

        const result = await billingService.cancelSubscription(apiKey);
        if (!result) return res.status(404).json({ error: 'No subscription found' });

        res.json({ message: 'Subscription cancelled' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });
  }

  /**
   * @openapi
   * /api/admin/rate-limits/health:
   *   get:
   *     tags: [Rate Limiting]
   *     summary: Rate limiter subsystem health
   *     description: Returns health status of all rate limiting subsystems (rate limiter, analytics, anomaly detector, geo limiter, billing).
   *     responses:
   *       200:
   *         description: Rate limiter health
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/RateLimitHealthResponse'
   */
  router.get('/health', (_req, res) => {
    const services = {
      rateLimiter: { status: 'ok', activeKeys: rateLimiterService.records.size },
    };
    if (analytics) services.analytics = { status: 'ok', enabled: analytics.enabled };
    if (anomalyDetector) services.anomalyDetector = { status: 'ok', enabled: anomalyDetector.enabled };
    if (geoLimiter) services.geoLimiter = { status: 'ok', enabled: geoLimiter.enabled };
    if (billingService) services.billing = { status: 'ok', enabled: billingService.enabled };

    res.json({ status: 'ok', timestamp: new Date().toISOString(), services });
  });

  return router;
}
