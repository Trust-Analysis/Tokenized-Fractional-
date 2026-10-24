/**
 * Tenant Admin Routes (Issue #900)
 *
 * Admin-only endpoints for tenant onboarding and post-onboarding quota
 * management, so negotiated custom enterprise quotas can be provisioned and
 * adjusted without editing the database directly.
 *
 * All routes are guarded by the provided admin auth middleware.
 */

import { Router } from 'express';

/**
 * @param {() => import('../services/tenantService.js').TenantService} getTenantService
 *        Factory resolving the TenantService (and its DB handle) lazily per
 *        request, so the database only needs to be initialized by the time an
 *        admin actually calls these endpoints.
 * @param {Function} adminAuth - Admin auth middleware (x-api-key check)
 * @param {Object} [options]
 * @param {Function} [options.writeLimiter] - Optional write rate limiter
 */
export function createTenantAdminRoutes(getTenantService, adminAuth, options = {}) {
  const router = Router();
  const writeLimiter = options.writeLimiter || ((_req, _res, next) => next());

  /**
   * @openapi
   * /api/admin/tenants:
   *   post:
   *     tags: [Tenants]
   *     summary: Onboard a new tenant (admin)
   *     description: Creates a tenant with the billing-plan default quota, or a negotiated custom quota via max_api_requests_per_min.
   *     security:
   *       - ApiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name]
   *             properties:
   *               name: { type: string }
   *               billing_plan: { type: string, enum: [standard, enterprise] }
   *               max_api_requests_per_min: { type: integer, minimum: 1, description: Optional negotiated custom quota override }
   *               config: { type: object }
   *     responses:
   *       201:
   *         description: Tenant onboarded
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Invalid or missing API key
   */
  router.post('/', adminAuth, writeLimiter, async (req, res) => {
    try {
      const tenant = await getTenantService().onboardTenant(req.body || {});
      res.status(201).json({ data: tenant });
    } catch (error) {
      req.log?.warn({ error: error.message }, 'Tenant onboarding failed');
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * @openapi
   * /api/admin/tenants/{tenantId}:
   *   get:
   *     tags: [Tenants]
   *     summary: Get tenant details (admin)
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: tenantId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Tenant details
   *       401:
   *         description: Invalid or missing API key
   *       404:
   *         description: Tenant not found
   */
  router.get('/:tenantId', adminAuth, async (req, res) => {
    try {
      const tenant = await getTenantService().getTenantById(req.params.tenantId);
      res.json({ data: tenant });
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });

  /**
   * @openapi
   * /api/admin/tenants/{tenantId}/quota:
   *   put:
   *     tags: [Tenants]
   *     summary: Update a tenant's API quota (admin)
   *     description: Adjusts max_api_requests_per_min for an existing tenant (e.g. negotiated enterprise uplift). Every change is audit-logged with actor and reason.
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: tenantId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [maxApiRequestsPerMin]
   *             properties:
   *               maxApiRequestsPerMin: { type: integer, minimum: 1 }
   *               reason: { type: string, description: Audit-log reason for the change }
   *     responses:
   *       200:
   *         description: Quota updated
   *       400:
   *         description: Invalid quota value
   *       401:
   *         description: Invalid or missing API key
   *       404:
   *         description: Tenant not found
   */
  router.put('/:tenantId/quota', adminAuth, writeLimiter, async (req, res) => {
    try {
      const { maxApiRequestsPerMin, reason } = req.body || {};
      const tenant = await getTenantService().updateTenantQuota(
        req.params.tenantId,
        { maxApiRequestsPerMin },
        { updatedBy: req.headers['x-api-key'] ? 'admin-api' : 'unknown', reason }
      );
      res.json({ data: tenant, message: 'Tenant quota updated' });
    } catch (error) {
      const notFound = /not found/i.test(error.message);
      res.status(notFound ? 404 : 400).json({ error: error.message });
    }
  });

  return router;
}
