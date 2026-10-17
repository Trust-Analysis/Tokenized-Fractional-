// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createWebhookService, WEBHOOK_EVENTS } from '../src/services/webhookService.js';
import { createWebhookRoutes } from '../src/routes/webhooks.js';
import express from 'express';
import request from 'supertest';

describe('Enterprise Webhook System (#291)', () => {
  let webhookService;
  let app;

  beforeEach(() => {
    webhookService = createWebhookService();
    app = express();
    app.use(express.json());
    app.use('/api/v1/webhooks', createWebhookRoutes(webhookService));
  });

  describe('Webhook Registration & Secret Management', () => {
    it('registers a webhook with auto-generated secret and signature', () => {
      const webhook = webhookService.registerWebhook({
        url: 'https://example.com/webhook',
        eventTypes: [WEBHOOK_EVENTS.ASSET_CREATED],
        description: 'Test Receiver',
      });

      expect(webhook.id).toBeDefined();
      expect(webhook.url).toBe('https://example.com/webhook');
      expect(webhook.secret).toHaveLength(64);
      expect(webhook.eventTypes).toContain(WEBHOOK_EVENTS.ASSET_CREATED);
    });

    it('validates URL format during registration', () => {
      expect(() => {
        webhookService.registerWebhook({ url: 'invalid-url' });
      }).toThrow('Valid URL starting with http/https is required');
    });

    it('generates and verifies HMAC-SHA256 signatures correctly', () => {
      const secret = 'super-secret-key';
      const payload = JSON.stringify({ event: 'asset.created', data: { id: 'asset-1' } });
      const signature = webhookService.generateSignature(payload, secret);

      expect(signature).toBeDefined();
      const isValid = webhookService.verifySignature(payload, signature, secret);
      expect(isValid).toBe(true);
    });

    it('encrypts and decrypts payload using AES-256-GCM', () => {
      const secret = 'a'.repeat(64); // 64 hex characters
      const data = { hello: 'world', assetId: 'rwa-100' };

      const encrypted = webhookService.encryptPayload(data, secret);
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();

      const decrypted = webhookService.decryptPayload(encrypted, secret);
      expect(decrypted).toEqual(data);
    });
  });

  describe('REST Webhook Endpoints', () => {
    it('POST /api/v1/webhooks registers a webhook via API', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .send({
          url: 'https://hooks.slack.com/services/123',
          eventTypes: ['*'],
          description: 'Slack Receiver',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.url).toBe('https://hooks.slack.com/services/123');
    });

    it('GET /api/v1/webhooks lists all registered webhooks', async () => {
      webhookService.registerWebhook({ url: 'https://example.com/1' });
      webhookService.registerWebhook({ url: 'https://example.com/2' });

      const res = await request(app).get('/api/v1/webhooks');
      expect(res.status).toBe(200);
      expect(res.body.webhooks.length).toBe(2);
    });

    it('GET /api/v1/webhooks/analytics provides monitoring metrics', async () => {
      const res = await request(app).get('/api/v1/webhooks/analytics');
      expect(res.status).toBe(200);
      expect(res.body.successRate).toBeDefined();
      expect(res.body.totalRegisteredWebhooks).toBeDefined();
    });

    it('POST /api/v1/webhooks/:id/test sends a test webhook', async () => {
      const webhook = webhookService.registerWebhook({ url: 'https://httpbin.org/post' });
      
      // Mock fetch for delivery test
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"status": "received"}'),
      });

      const res = await request(app).post(`/api/v1/webhooks/${webhook.id}/test`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.delivery.status).toBe('success');
    });
  });
});
