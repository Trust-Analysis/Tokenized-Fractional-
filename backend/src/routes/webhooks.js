// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { Router } from 'express';

export function createWebhookRoutes(webhookService, logger, adminAuthMiddleware) {
  const router = Router();

  // Public webhook event types endpoint
  router.get('/events', (_req, res) => {
    res.json({
      events: [
        { type: 'asset.created', description: 'Triggered when a new RWA asset is registered' },
        { type: 'asset.updated', description: 'Triggered when asset metadata is modified' },
        { type: 'asset.deleted', description: 'Triggered when an asset is removed' },
        { type: 'asset.approved', description: 'Triggered when an asset is verified/approved' },
        { type: 'transaction.created', description: 'Triggered when a share purchase transaction is initiated' },
        { type: 'transaction.completed', description: 'Triggered when a purchase transaction settles on chain' },
        { type: 'transaction.failed', description: 'Triggered when a transaction fails' },
        { type: 'user.action', description: 'Triggered on key user activities' },
        { type: 'custom.event', description: 'Custom user-defined business events' },
        { type: '*', description: 'Subscribe to all events' },
      ],
    });
  });

  // Protected endpoints below (Admin or Auth required)
  const authGuard = adminAuthMiddleware || ((_req, _res, next) => next());

  router.post('/', authGuard, (req, res) => {
    try {
      const { url, secret, eventTypes, ipWhitelist, description, encrypted } = req.body;
      const webhook = webhookService.registerWebhook({
        url,
        secret,
        eventTypes,
        ipWhitelist,
        description,
        encrypted,
      });
      res.status(201).json(webhook);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/', authGuard, (_req, res) => {
    const webhooks = webhookService.listWebhooks();
    res.json({ webhooks });
  });

  router.get('/analytics', authGuard, (_req, res) => {
    const analytics = webhookService.getAnalytics();
    res.json(analytics);
  });

  router.get('/:id', authGuard, (req, res) => {
    const webhook = webhookService.getWebhook(req.params.id);
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    res.json(webhook);
  });

  router.patch('/:id', authGuard, (req, res) => {
    try {
      const updated = webhookService.updateWebhook(req.params.id, req.body);
      res.json(updated);
    } catch (err) {
      res.status(err.message === 'Webhook not found' ? 404 : 400).json({ error: err.message });
    }
  });

  router.delete('/:id', authGuard, (req, res) => {
    try {
      webhookService.deleteWebhook(req.params.id);
      res.json({ success: true, message: 'Webhook deleted' });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post('/:id/test', authGuard, async (req, res) => {
    try {
      const result = await webhookService.sendTestWebhook(req.params.id);
      res.json({ success: true, delivery: result });
    } catch (err) {
      res.status(err.message === 'Webhook not found' ? 404 : 500).json({ error: err.message });
    }
  });

  router.get('/:id/deliveries', authGuard, (req, res) => {
    const deliveries = webhookService.getDeliveries(req.params.id);
    res.json({ deliveries });
  });

  router.post('/deliveries/:deliveryId/replay', authGuard, async (req, res) => {
    try {
      const result = await webhookService.replayDelivery(req.params.deliveryId);
      res.json({ success: true, delivery: result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
