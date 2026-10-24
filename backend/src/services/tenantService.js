/**
 * Tenant Management Service
 * 
 * Handles multi-tenancy operations: onboarding, billing configurations, 
 * performance isolation metrics, and cross-tenant analytics.
 */

import { randomBytes } from 'crypto';

export class TenantService {
  /**
   * Default performance isolation quotas (requests/min) per billing plan.
   * These are the fallbacks used when no negotiated custom quota is supplied.
   */
  static PLAN_QUOTAS = {
    enterprise: 1000,
    standard: 100
  };

  constructor(db, logger) {
    this.db = db;
    this.logger = logger || console;
  }

  /**
   * Resolve the effective quota for a tenant: an explicit custom override
   * (negotiated enterprise deal, promotional period, etc.) always wins over
   * the billing-plan default.
   */
  resolveQuota(billingPlan, customQuota) {
    if (customQuota !== undefined && customQuota !== null) {
      return this.validateQuota(customQuota);
    }
    return TenantService.PLAN_QUOTAS[billingPlan] ?? TenantService.PLAN_QUOTAS.standard;
  }

  /**
   * Validate a custom quota value (positive integer requests/minute)
   */
  validateQuota(value) {
    const quota = Number(value);
    if (!Number.isInteger(quota) || quota <= 0) {
      throw new Error('max_api_requests_per_min must be a positive integer');
    }
    return quota;
  }

  /**
   * Automates the onboarding of a new tenant.
   *
   * Supports a per-tenant custom quota override via
   * `tenantData.max_api_requests_per_min` for negotiated enterprise deals;
   * when omitted, the billing-plan default applies.
   */
  async onboardTenant(tenantData) {
    const {
      name,
      billing_plan = 'standard',
      config = {},
      max_api_requests_per_min: customQuota
    } = tenantData;
    
    if (!name) {
      throw new Error('Tenant name is required for onboarding');
    }

    const tenantId = `tnt_${randomBytes(8).toString('hex')}`;
    
    // Performance isolation quota: custom override, else plan default
    const max_api_requests = this.resolveQuota(billing_plan, customQuota);

    await this.db('tenants').insert({
      id: tenantId,
      name,
      billing_plan,
      max_api_requests_per_min: max_api_requests,
      config: JSON.stringify(config)
    });

    this.logger.info(
      { tenantId, name, plan: billing_plan, maxApiRequestsPerMin: max_api_requests, customQuota: customQuota != null },
      'New tenant successfully onboarded'
    );
    
    return this.getTenantById(tenantId);
  }

  /**
   * Admin-only: adjust an existing tenant's API quota post-onboarding
   * (e.g. a negotiated enterprise uplift) without touching the database
   * directly. Every change is audit-logged with actor and reason.
   *
   * @param {string} tenantId
   * @param {{ maxApiRequestsPerMin: number }} quotaUpdate
   * @param {{ updatedBy?: string, reason?: string }} audit
   */
  async updateTenantQuota(tenantId, quotaUpdate = {}, audit = {}) {
    if (!tenantId) {
      throw new Error('Tenant ID is required to update quota');
    }

    const newQuota = this.validateQuota(quotaUpdate.maxApiRequestsPerMin);
    const tenant = await this.getTenantById(tenantId);
    const previousQuota = tenant.max_api_requests_per_min;

    await this.db('tenants')
      .where({ id: tenantId })
      .update({ max_api_requests_per_min: newQuota });

    this.logger.info(
      {
        tenantId,
        previousQuota,
        newQuota,
        updatedBy: audit.updatedBy || 'unknown',
        reason: audit.reason || 'unspecified'
      },
      'Tenant API quota updated (admin action)'
    );

    return this.getTenantById(tenantId);
  }

  /**
   * Retrieves tenant configuration and billing details
   */
  async getTenantById(tenantId) {
    const tenant = await this.db('tenants').where({ id: tenantId }).first();
    if (!tenant) throw new Error('Tenant not found');
    return tenant;
  }

  /**
   * Updates tenant-specific configurations (caching strategies, rate limits)
   */
  async updateTenantConfig(tenantId, newConfig) {
    const tenant = await this.getTenantById(tenantId);
    const updatedConfig = { ...tenant.config, ...newConfig };
    
    await this.db('tenants')
      .where({ id: tenantId })
      .update({ config: JSON.stringify(updatedConfig) });
      
    this.logger.info({ tenantId }, 'Tenant configuration updated');
    return updatedConfig;
  }

  /**
   * Tenant Analytics & Reporting
   * Aggregates usage data specific to the tenant for billing integration.
   */
  async getTenantAnalytics(tenantId) {
    // Because RLS is active, queries executed with a tenant-scoped transaction 
    // will naturally only aggregate that specific tenant's data.
    const assetCount = await this.db('assets').where({ tenant_id: tenantId }).count('contract_id as total');
    const txCount = await this.db('transactions').where({ tenant_id: tenantId }).count('id as total');
    
    return {
      tenantId,
      totalAssets: parseInt(assetCount[0].total, 10),
      totalTransactions: parseInt(txCount[0].total, 10),
      reportGeneratedAt: new Date().toISOString()
    };
  }
}
