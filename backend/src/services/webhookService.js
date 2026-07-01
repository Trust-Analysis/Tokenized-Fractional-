// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/webhookService.js — webhook delivery with retry logic.
 */

import { randomUUID } from 'crypto';
import { setTimeout } from 'timers/promises';
import { loadWebhooks, saveWebhooks } from './dataService.js';
import { logger } from './logger.js';

async function deliverToWebhook(webhook, payload) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'X-Webhook-Event': payload.event,
    'X-Webhook-Delivery': randomUUID(),
  };

  const response = await fetch(webhook.url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Webhook responded with ${response.status}`);
  }
}

async function deliverWebhookWithRetry(webhook, payload, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await deliverToWebhook(webhook, payload);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await setTimeout(1000 * attempt);
      }
    }
  }
  throw lastError;
}

/**
 * Fire webhooks registered for the given event.
 * Automatically disables webhooks that fail 5 consecutive times.
 */
export async function fireWebhooks(event, data) {
  const webhooks = loadWebhooks();
  const active = Object.values(webhooks).filter((w) => w.active && w.events.includes(event));
  if (active.length === 0) {
    logger.info(
      { event, webhookCount: Object.keys(webhooks).length },
      'No active webhooks for event',
    );
    return;
  }
  logger.info({ event, count: active.length, urls: active.map((w) => w.url) }, 'Firing webhooks');

  const payload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const results = await Promise.allSettled(active.map((w) => deliverWebhookWithRetry(w, payload)));

  let changed = false;
  active.forEach((webhook, i) => {
    if (results[i].status === 'rejected') {
      webhook.failureCount = (webhook.failureCount || 0) + 1;
      webhook.lastFailureAt = new Date().toISOString();
      if (webhook.failureCount >= 5) {
        webhook.active = false;
        logger.warn(
          { webhookId: webhook.id, url: webhook.url },
          'Webhook auto-disabled after 5 failures',
        );
      }
    } else {
      webhook.failureCount = 0;
      webhook.lastSuccessAt = new Date().toISOString();
    }
    webhook.updatedAt = new Date().toISOString();
    changed = true;
  });

  if (changed) {
    saveWebhooks(webhooks);
  }
}
