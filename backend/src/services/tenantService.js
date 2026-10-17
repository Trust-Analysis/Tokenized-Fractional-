/**
 * Tenant Management Service
 * 
 * Handles multi-tenancy operations: onboarding, billing configurations, 
 * performance isolation metrics, and cross-tenant analytics.
 */

import { randomBytes } from 'crypto';

export class TenantService {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger || console;
  }

  /**
   * Automates the onboarding of a new tenant
   */
  async onboardTenant(tenantData) {
    const { name, billing_plan = 'standard', config = {} } = tenantData;
    
    if (!name) {
      throw new Error('Tenant name is required for onboarding');
    }

    const tenantId = `tnt_${randomBytes(8).toString('hex')}`;
    
    // Default performance isolation quotas
    const max_api_requests = billing_plan === 'enterprise' ? 1000 : 100;

    await this.db('tenants').insert({
      id: tenantId,
      name,
      billing_plan,
      max_api_requests_per_min: max_api_requests,
      config: JSON.stringify(config)
    });

    this.logger.info({ tenantId, name, plan: billing_plan }, 'New tenant successfully onboarded');
    
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
