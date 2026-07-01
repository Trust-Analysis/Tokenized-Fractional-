// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/apiKeyService.js — API key management service
 *
 * Provides full lifecycle management for API keys including:
 * - Creating new keys with optional expiration
 * - Validating and tracking usage
 * - Rotating keys
 * - Revoking keys
 * - Querying key metadata and usage statistics
 */

import { randomBytes, createHash } from 'crypto';

/**
 * Generate a cryptographically secure random API key
 * Format: rwa_<32 random hex chars> (48 chars total)
 */
function generateApiKey() {
  const random = randomBytes(32).toString('hex');
  return `rwa_${random}`;
}

/**
 * Hash an API key for storage (one-way hash)
 */
function hashApiKey(apiKey) {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * API Key Service
 * Manages API keys in a database via Knex
 */
export class ApiKeyService {
  constructor(knex, logger) {
    this.knex = knex;
    this.logger = logger || console;
    this.tableName = 'api_keys';
  }

  /**
   * Create a new API key
   * @param {Object} options
   * @param {string} options.name - Descriptive name for the key
   * @param {Date} options.expiresAt - Optional expiration date
   * @param {string} options.description - Optional description
   * @returns {Promise<{key: string, id: string, name: string, expiresAt: ?Date, createdAt: Date}>}
   */
  async create({ name, expiresAt, description } = {}) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('API key name is required and must be a non-empty string');
    }

    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    const now = new Date();

    const result = await this.knex(this.tableName)
      .insert({
        id: `key_${randomBytes(12).toString('hex')}`,
        name: name.trim(),
        key_hash: keyHash,
        description: description ? description.trim() : null,
        expires_at: expiresAt || null,
        revoked_at: null,
        created_at: now,
        updated_at: now,
        last_used_at: null,
        usage_count: 0,
      })
      .returning(['id', 'name', 'expires_at', 'created_at', 'description']);

    this.logger.info({ keyName: name }, 'API key created');

    return {
      key: apiKey, // Only returned once during creation
      id: result[0].id,
      name: result[0].name,
      description: result[0].description,
      expiresAt: result[0].expires_at,
      createdAt: result[0].created_at,
      note: 'Store this key securely. You will not be able to see it again.',
    };
  }

  /**
   * Validate an API key
   * @param {string} apiKey - The API key to validate
   * @returns {Promise<{valid: boolean, id: string, name: string, expiresAt: ?Date, revoked: boolean, expired: boolean}>}
   */
  async validate(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      return { valid: false, reason: 'Invalid API key format' };
    }

    const keyHash = hashApiKey(apiKey);

    const row = await this.knex(this.tableName).where('key_hash', keyHash).first();

    if (!row) {
      return { valid: false, reason: 'API key not found' };
    }

    const now = new Date();
    const revoked = row.revoked_at !== null;
    const expired = row.expires_at && new Date(row.expires_at) < now;

    if (revoked) {
      return { valid: false, reason: 'API key has been revoked', id: row.id };
    }

    if (expired) {
      return { valid: false, reason: 'API key has expired', id: row.id };
    }

    // Update last_used_at and increment usage_count
    await this.knex(this.tableName)
      .where('id', row.id)
      .update({
        last_used_at: now,
        usage_count: this.knex.raw('usage_count + 1'),
        updated_at: now,
      });

    return {
      valid: true,
      id: row.id,
      name: row.name,
      expiresAt: row.expires_at,
      revoked: false,
      expired: false,
    };
  }

  /**
   * Get a single API key by ID (metadata only, not the secret key)
   * @param {string} id - The API key ID
   * @returns {Promise<Object|null>}
   */
  async getById(id) {
    const row = await this.knex(this.tableName).where('id', id).first();

    if (!row) return null;

    return this._formatKeyRow(row);
  }

  /**
   * List all API keys (metadata only)
   * @param {Object} options
   * @param {boolean} options.includeRevoked - Include revoked keys
   * @returns {Promise<Array>}
   */
  async list({ includeRevoked = false } = {}) {
    let query = this.knex(this.tableName);

    if (!includeRevoked) {
      query = query.whereNull('revoked_at');
    }

    const rows = await query.orderBy('created_at', 'desc');
    return rows.map((r) => this._formatKeyRow(r));
  }

  /**
   * Rotate an API key (revoke old, create new)
   * @param {string} id - The API key ID to rotate
   * @param {Object} options - Options for new key
   * @returns {Promise<{oldKey: Object, newKey: Object}>}
   */
  async rotate(id, options = {}) {
    const oldKey = await this.getById(id);
    if (!oldKey) {
      throw new Error('API key not found');
    }

    if (oldKey.revoked) {
      throw new Error('Cannot rotate a revoked API key');
    }

    // Revoke the old key
    const now = new Date();
    await this.knex(this.tableName).where('id', id).update({
      revoked_at: now,
      updated_at: now,
    });

    // Create new key with same name (and optional new expiration)
    const newKeyData = await this.create({
      name: `${oldKey.name} (rotated)`,
      expiresAt: options.expiresAt || oldKey.expiresAt,
      description: options.description || oldKey.description,
    });

    this.logger.info({ oldKeyId: id, newKeyId: newKeyData.id }, 'API key rotated');

    return {
      oldKey: { id: oldKey.id, revokedAt: now },
      newKey: newKeyData,
    };
  }

  /**
   * Revoke an API key
   * @param {string} id - The API key ID to revoke
   * @returns {Promise<Object>}
   */
  async revoke(id) {
    const key = await this.getById(id);
    if (!key) {
      throw new Error('API key not found');
    }

    if (key.revoked) {
      throw new Error('API key is already revoked');
    }

    const now = new Date();
    await this.knex(this.tableName).where('id', id).update({
      revoked_at: now,
      updated_at: now,
    });

    this.logger.info({ keyId: id }, 'API key revoked');

    return { id, revokedAt: now };
  }

  /**
   * Get usage statistics for a key
   * @param {string} id - The API key ID
   * @returns {Promise<Object|null>}
   */
  async getUsageStats(id) {
    const row = await this.knex(this.tableName).where('id', id).first();

    if (!row) return null;

    const now = new Date();
    const expired = row.expires_at && new Date(row.expires_at) < now;

    return {
      id: row.id,
      name: row.name,
      usageCount: row.usage_count,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      expired,
      revoked: !!row.revoked_at,
      revokedAt: row.revoked_at,
    };
  }

  /**
   * Delete an API key (hard delete)
   * @param {string} id - The API key ID to delete
   * @returns {Promise<void>}
   */
  async delete(id) {
    const key = await this.getById(id);
    if (!key) {
      throw new Error('API key not found');
    }

    await this.knex(this.tableName).where('id', id).del();

    this.logger.info({ keyId: id }, 'API key deleted');
  }

  /**
   * Get all keys that are expired (regardless of revocation)
   * @returns {Promise<Array>}
   */
  async getExpiredKeys() {
    const now = new Date();
    const rows = await this.knex(this.tableName)
      .whereNotNull('expires_at')
      .where('expires_at', '<', now)
      .whereNull('revoked_at')
      .orderBy('expires_at', 'asc');

    return rows.map((r) => this._formatKeyRow(r));
  }

  /**
   * Format a database row for API responses
   * @private
   */
  _formatKeyRow(row) {
    const now = new Date();
    const expired = row.expires_at && new Date(row.expires_at) < now;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      revoked: !!row.revoked_at,
      expired,
      usageCount: row.usage_count,
      lastUsedAt: row.last_used_at,
    };
  }
}

/**
 * Factory function to create an ApiKeyService instance
 */
export function createApiKeyService(knex, logger) {
  return new ApiKeyService(knex, logger);
}
