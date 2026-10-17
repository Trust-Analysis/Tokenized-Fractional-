// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { createHmac, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto';

export const WEBHOOK_EVENTS = {
  ASSET_CREATED: 'asset.created',
  ASSET_UPDATED: 'asset.updated',
  ASSET_DELETED: 'asset.deleted',
  ASSET_APPROVED: 'asset.approved',
  TRANSACTION_CREATED: 'transaction.created',
  TRANSACTION_COMPLETED: 'transaction.completed',
  TRANSACTION_FAILED: 'transaction.failed',
  USER_ACTION: 'user.action',
  CUSTOM_EVENT: 'custom.event',
};

class WebhookService {
  constructor(logger = console) {
    this.logger = logger;
    this.webhooks = new Map(); // id -> webhook config
    this.deliveries = new Map(); // deliveryId -> delivery log
    this.maxRetries = 5;
  }

  /**
   * Register a new webhook endpoint.
   */
  registerWebhook({ url, secret, eventTypes = [], ipWhitelist = [], description = '', encrypted = false }) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      throw new Error('Valid URL starting with http/https is required');
    }

    const id = randomUUID();
    const webhookSecret = secret || randomBytes(32).toString('hex');
    const webhook = {
      id,
      url,
      secret: webhookSecret,
      eventTypes: Array.isArray(eventTypes) ? eventTypes : [],
      ipWhitelist: Array.isArray(ipWhitelist) ? ipWhitelist : [],
      description,
      encrypted: Boolean(encrypted),
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.webhooks.set(id, webhook);
    this.logger.info({ webhookId: id, url }, 'Webhook registered successfully');
    return webhook;
  }

  getWebhook(id) {
    return this.webhooks.get(id) || null;
  }

  listWebhooks() {
    return Array.from(this.webhooks.values());
  }

  updateWebhook(id, updates = {}) {
    const webhook = this.getWebhook(id);
    if (!webhook) {
      throw new Error('Webhook not found');
    }

    const updated = {
      ...webhook,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.webhooks.set(id, updated);
    return updated;
  }

  deleteWebhook(id) {
    if (!this.webhooks.has(id)) {
      throw new Error('Webhook not found');
    }
    this.webhooks.delete(id);
    return true;
  }

  /**
   * Generate HMAC SHA256 signature for payload validation.
   */
  generateSignature(payloadString, secret) {
    return createHmac('sha256', secret).update(payloadString).digest('hex');
  }

  /**
   * Verify payload signature.
   */
  verifySignature(payloadString, signature, secret) {
    const expected = this.generateSignature(payloadString, secret);
    return expected === signature;
  }

  /**
   * Encrypt payload using AES-256-GCM.
   */
  encryptPayload(payloadObj, secretHex) {
    const key = Buffer.from(secretHex.slice(0, 64).padEnd(64, '0'), 'hex').subarray(0, 32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(JSON.stringify(payloadObj), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      iv: iv.toString('hex'),
      authTag,
      data: encrypted,
    };
  }

  /**
   * Decrypt AES-256-GCM encrypted payload.
   */
  decryptPayload(encryptedObj, secretHex) {
    const key = Buffer.from(secretHex.slice(0, 64).padEnd(64, '0'), 'hex').subarray(0, 32);
    const iv = Buffer.from(encryptedObj.iv, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(encryptedObj.authTag, 'hex'));

    let decrypted = decipher.update(encryptedObj.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }

  /**
   * Dispatch an event to all subscribed webhooks.
   */
  async dispatchEvent(eventType, eventData) {
    const matchingWebhooks = Array.from(this.webhooks.values()).filter(
      w => w.active && (w.eventTypes.includes('*') || w.eventTypes.includes(eventType))
    );

    const deliveryPromises = matchingWebhooks.map(webhook =>
      this.deliverWebhook(webhook, eventType, eventData)
    );

    return Promise.all(deliveryPromises);
  }

  /**
   * Execute webhook delivery with retry logic and backoff.
   */
  async deliverWebhook(webhook, eventType, eventData, attempt = 1) {
    const deliveryId = randomUUID();
    const timestamp = new Date().toISOString();
    
    let payload = {
      id: deliveryId,
      event: eventType,
      timestamp,
      data: eventData,
    };

    let bodyString = JSON.stringify(payload);
    let isEncrypted = false;

    if (webhook.encrypted) {
      payload = this.encryptPayload(payload, webhook.secret);
      bodyString = JSON.stringify(payload);
      isEncrypted = true;
    }

    const signature = this.generateSignature(bodyString, webhook.secret);

    const deliveryLog = {
      id: deliveryId,
      webhookId: webhook.id,
      url: webhook.url,
      eventType,
      attempt,
      status: 'pending',
      statusCode: null,
      responseBody: null,
      error: null,
      isEncrypted,
      signature,
      durationMs: 0,
      timestamp,
    };

    const startTime = Date.now();

    try {
      // Execute fetch with custom headers
      const headers = {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': eventType,
        'X-Webhook-Delivery': deliveryId,
        'X-Webhook-Encrypted': isEncrypted ? 'true' : 'false',
        'User-Agent': 'RWA-Platform-Webhook/1.0',
      };

      const fetchImpl = globalThis.fetch || (await import('node-fetch')).default;
      const response = await fetchImpl(webhook.url, {
        method: 'POST',
        headers,
        body: bodyString,
        timeout: 5000,
      });

      deliveryLog.durationMs = Date.now() - startTime;
      deliveryLog.statusCode = response.status;
      
      let text = '';
      try {
        text = await response.text();
      } catch {
        text = '';
      }
      deliveryLog.responseBody = text.slice(0, 1000);

      if (response.ok) {
        deliveryLog.status = 'success';
        this.deliveries.set(deliveryId, deliveryLog);
        this.logger.info({ webhookId: webhook.id, deliveryId, attempt }, 'Webhook delivery succeeded');
        return deliveryLog;
      } else {
        throw new Error(`HTTP status ${response.status}`);
      }
    } catch (err) {
      deliveryLog.durationMs = Date.now() - startTime;
      deliveryLog.status = 'failed';
      deliveryLog.error = err.message;
      this.deliveries.set(deliveryId, deliveryLog);

      this.logger.warn({ webhookId: webhook.id, deliveryId, attempt, error: err.message }, 'Webhook delivery attempt failed');

      // Retry with exponential backoff if attempt < maxRetries
      if (attempt < this.maxRetries) {
        const delayMs = Math.min(100 * Math.pow(2, attempt), 2000);
        await new Promise(res => setTimeout(res, delayMs));
        return this.deliverWebhook(webhook, eventType, eventData, attempt + 1);
      }

      return deliveryLog;
    }
  }

  /**
   * Replay a previous delivery.
   */
  async replayDelivery(deliveryId) {
    const existing = this.deliveries.get(deliveryId);
    if (!existing) {
      throw new Error('Delivery record not found');
    }

    const webhook = this.getWebhook(existing.webhookId);
    if (!webhook) {
      throw new Error('Webhook configuration no longer exists');
    }

    return this.deliverWebhook(webhook, existing.eventType, { replayedFrom: deliveryId }, 1);
  }

  /**
   * Send a test webhook payload.
   */
  async sendTestWebhook(webhookId) {
    const webhook = this.getWebhook(webhookId);
    if (!webhook) {
      throw new Error('Webhook not found');
    }

    const testData = {
      message: 'This is a test notification from RWA Marketplace Webhook System',
      test: true,
      timestamp: new Date().toISOString(),
    };

    return this.deliverWebhook(webhook, WEBHOOK_EVENTS.CUSTOM_EVENT, testData, 1);
  }

  /**
   * Get delivery records for a webhook.
   */
  getDeliveries(webhookId) {
    return Array.from(this.deliveries.values())
      .filter(d => d.webhookId === webhookId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Get overall webhook performance analytics.
   */
  getAnalytics() {
    const allDeliveries = Array.from(this.deliveries.values());
    const totalDeliveries = allDeliveries.length;
    const successful = allDeliveries.filter(d => d.status === 'success').length;
    const failed = allDeliveries.filter(d => d.status === 'failed').length;

    const avgLatency = totalDeliveries > 0
      ? Math.round(allDeliveries.reduce((acc, d) => acc + (d.durationMs || 0), 0) / totalDeliveries)
      : 0;

    const eventsBreakdown = {};
    allDeliveries.forEach(d => {
      eventsBreakdown[d.eventType] = (eventsBreakdown[d.eventType] || 0) + 1;
    });

    return {
      totalRegisteredWebhooks: this.webhooks.size,
      totalDeliveries,
      successfulDeliveries: successful,
      failedDeliveries: failed,
      successRate: totalDeliveries > 0 ? Number(((successful / totalDeliveries) * 100).toFixed(2)) : 100,
      averageDurationMs: avgLatency,
      eventsBreakdown,
    };
  }
}

export const createWebhookService = (logger) => new WebhookService(logger);

/**
 * Fire webhooks for a given event. Convenience function that
 * creates a temporary service instance and dispatches the event.
 */
export const fireWebhooks = async (eventType, eventData, logger = console) => {
  const service = createWebhookService(logger);
  return service.dispatchEvent(eventType, eventData);
};
