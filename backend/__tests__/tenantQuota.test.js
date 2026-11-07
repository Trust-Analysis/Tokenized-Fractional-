/**
 * Issue #900: Per-tenant custom quota overrides
 *
 * Covers:
 *  - custom quota at onboarding (negotiated enterprise deals)
 *  - billing-plan defaults as fallback
 *  - admin-only post-onboarding quota update endpoint
 *  - validation and audit logging
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import knexFactory from 'knex';
import express from 'express';
import http from 'http';
import { TenantService } from '../src/services/tenantService.js';
import { createTenantAdminRoutes } from '../src/routes/tenantAdmin.js';

const ADMIN_KEY = 'test-admin-key';

function adminAuth(req, res, next) {
  if (req.headers['x-api-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
  }
  next();
}

describe('Issue #900: tenant custom quota overrides', () => {
  let db;
  let service;
  let server;
  let baseUrl;

  const logs = [];
  const fakeLogger = {
    info: (obj, msg) => logs.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => logs.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => logs.push({ level: 'error', obj, msg }),
  };

  beforeAll(async () => {
    db = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.schema.createTable('tenants', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('billing_plan').defaultTo('standard');
      table.integer('max_api_requests_per_min').defaultTo(100);
      table.text('config');
    });

    service = new TenantService(db, fakeLogger);

    const app = express();
    app.use(express.json());
    app.use('/api/admin/tenants', createTenantAdminRoutes(() => service, adminAuth));

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.destroy();
  });

  test('plan defaults are preserved when no custom quota is supplied', async () => {
    const standard = await service.onboardTenant({ name: 'Standard Co' });
    expect(standard.max_api_requests_per_min).toBe(100);

    const enterprise = await service.onboardTenant({ name: 'Enterprise Co', billing_plan: 'enterprise' });
    expect(enterprise.max_api_requests_per_min).toBe(1000);
  });

  test('custom quota override at onboarding beats the billing-plan default', async () => {
    const tenant = await service.onboardTenant({
      name: 'Acme Corp',
      billing_plan: 'enterprise',
      max_api_requests_per_min: 5000,
    });
    expect(tenant.max_api_requests_per_min).toBe(5000);

    // Also allowed on lower tiers (e.g. promotional periods)
    const promo = await service.onboardTenant({
      name: 'Promo Co',
      billing_plan: 'standard',
      max_api_requests_per_min: 250,
    });
    expect(promo.max_api_requests_per_min).toBe(250);
  });

  test('invalid custom quotas are rejected before touching the database', async () => {
    for (const bad of [0, -5, 1.5, 'abc', NaN]) {
      await expect(
        service.onboardTenant({ name: 'Bad Co', max_api_requests_per_min: bad })
      ).rejects.toThrow('max_api_requests_per_min must be a positive integer');
    }
    expect(await db('tenants').where({ name: 'Bad Co' })).toHaveLength(0);
  });

  test('updateTenantQuota adjusts an existing tenant and audit-logs the change', async () => {
    const tenant = await service.onboardTenant({ name: 'Uplift Co', billing_plan: 'enterprise' });
    expect(tenant.max_api_requests_per_min).toBe(1000);

    const updated = await service.updateTenantQuota(
      tenant.id,
      { maxApiRequestsPerMin: 7500 },
      { updatedBy: 'sales-team', reason: 'Negotiated uplift, deal #42' }
    );

    expect(updated.max_api_requests_per_min).toBe(7500);
    expect(await service.getTenantById(tenant.id)).toMatchObject({ max_api_requests_per_min: 7500 });

    const auditEntry = logs.find(
      (l) => l.msg === 'Tenant API quota updated (admin action)' && l.obj.tenantId === tenant.id
    );
    expect(auditEntry).toBeTruthy();
    expect(auditEntry.obj.previousQuota).toBe(1000);
    expect(auditEntry.obj.newQuota).toBe(7500);
    expect(auditEntry.obj.updatedBy).toBe('sales-team');
    expect(auditEntry.obj.reason).toBe('Negotiated uplift, deal #42');
  });

  test('updateTenantQuota validates quota and tenant id', async () => {
    const tenant = await service.onboardTenant({ name: 'Validation Co' });
    await expect(service.updateTenantQuota(tenant.id, { maxApiRequestsPerMin: 0 })).rejects.toThrow(
      'max_api_requests_per_min must be a positive integer'
    );
    await expect(service.updateTenantQuota('', { maxApiRequestsPerMin: 100 })).rejects.toThrow(
      'Tenant ID is required'
    );
    await expect(
      service.updateTenantQuota('tnt_missing', { maxApiRequestsPerMin: 100 })
    ).rejects.toThrow('Tenant not found');
  });

  test('admin endpoint PUT /:tenantId/quota requires the admin key', async () => {
    const tenant = await service.onboardTenant({ name: 'Endpoint Co' });

    const unauthorized = await fetch(`${baseUrl}/api/admin/tenants/${tenant.id}/quota`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxApiRequestsPerMin: 999 }),
    });
    expect(unauthorized.status).toBe(401);

    // Unchanged after rejected call
    expect((await service.getTenantById(tenant.id)).max_api_requests_per_min).toBe(100);
  });

  test('admin endpoint PUT /:tenantId/quota updates the quota', async () => {
    const tenant = await service.onboardTenant({ name: 'Endpoint Co 2', billing_plan: 'enterprise' });

    const res = await fetch(`${baseUrl}/api/admin/tenants/${tenant.id}/quota`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({ maxApiRequestsPerMin: 2500, reason: 'Support ticket SUP-9' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.max_api_requests_per_min).toBe(2500);

    const auditEntry = logs.find(
      (l) => l.msg === 'Tenant API quota updated (admin action)' && l.obj.tenantId === tenant.id
    );
    expect(auditEntry.obj.reason).toBe('Support ticket SUP-9');
  });

  test('admin endpoint rejects invalid quotas with 400 and unknown tenants with 404', async () => {
    const tenant = await service.onboardTenant({ name: 'Endpoint Co 3' });

    const invalid = await fetch(`${baseUrl}/api/admin/tenants/${tenant.id}/quota`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({ maxApiRequestsPerMin: -1 }),
    });
    expect(invalid.status).toBe(400);

    const missing = await fetch(`${baseUrl}/api/admin/tenants/tnt_does_not_exist/quota`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({ maxApiRequestsPerMin: 100 }),
    });
    expect(missing.status).toBe(404);

    // Original quota untouched by the invalid attempts
    expect((await service.getTenantById(tenant.id)).max_api_requests_per_min).toBe(100);
  });

  test('admin onboarding endpoint accepts a custom quota override', async () => {
    const res = await fetch(`${baseUrl}/api/admin/tenants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({
        name: 'Endpoint Enterprise',
        billing_plan: 'enterprise',
        max_api_requests_per_min: 12000,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.max_api_requests_per_min).toBe(12000);
  });

  test('admin GET endpoint returns tenant details including the quota', async () => {
    const tenant = await service.onboardTenant({ name: 'Read Co', max_api_requests_per_min: 300 });

    const res = await fetch(`${baseUrl}/api/admin/tenants/${tenant.id}`, {
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(tenant.id);
    expect(body.data.max_api_requests_per_min).toBe(300);
  });
});
