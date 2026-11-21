import { apiCacheService } from './apiCacheService.js';

const API_BASE = '/api/v1/webhooks';

export const webhookService = {
  async fetchWebhooks(apiKey = '') {
    return apiCacheService.fetchWithCache(API_BASE, {
      headers: { 'x-api-key': apiKey },
      ttl: 2 * 60 * 1000,
    });
  },

  async registerWebhook(data, apiKey = '') {
    const res = await fetch(`${API_BASE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to register webhook');
    }
    apiCacheService.invalidate('/api/v1/webhooks');
    return res.json();
  },

  async updateWebhook(id, data, apiKey = '') {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update webhook');
    apiCacheService.invalidate('/api/v1/webhooks');
    return res.json();
  },

  async deleteWebhook(id, apiKey = '') {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey },
    });
    if (!res.ok) throw new Error('Failed to delete webhook');
    apiCacheService.invalidate('/api/v1/webhooks');
    return res.json();
  },

  async testWebhook(id, apiKey = '') {
    const res = await fetch(`${API_BASE}/${id}/test`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
    });
    if (!res.ok) throw new Error('Failed to test webhook');
    apiCacheService.invalidate('/api/v1/webhooks');
    return res.json();
  },

  async fetchDeliveries(id, apiKey = '') {
    return apiCacheService.fetchWithCache(`${API_BASE}/${id}/deliveries`, {
      headers: { 'x-api-key': apiKey },
      ttl: 30 * 1000,
    });
  },

  async replayDelivery(deliveryId, apiKey = '') {
    const res = await fetch(`${API_BASE}/deliveries/${deliveryId}/replay`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
    });
    if (!res.ok) throw new Error('Failed to replay delivery');
    apiCacheService.invalidate('/api/v1/webhooks');
    return res.json();
  },

  async fetchAnalytics(apiKey = '') {
    return apiCacheService.fetchWithCache(`${API_BASE}/analytics`, {
      headers: { 'x-api-key': apiKey },
      ttl: 60 * 1000,
    });
  },
};