// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Background jobs queue built on BullMQ (Issue #569).
 *
 * Synchronous tasks that used to block the main event loop — such as dispatching
 * emails — are enqueued here and processed by a dedicated Worker process
 * (`worker.js`). BullMQ connects to the same Redis instance already used for
 * caching (`REDIS_URL` + TLS options), so no new infrastructure is required.
 *
 * When Redis is not configured (e.g. local dev without Redis), producers fall
 * back to running the task inline so behaviour stays backwards-compatible.
 */

import { Queue, QueueScheduler } from 'bullmq';
import Redis from 'ioredis';
import { buildTlsOptions } from '../cache.js';

const REDIS_URL = process.env.REDIS_URL || '';

export const QUEUE_NAME = 'background';

export const JOB_NAMES = {
  EMAIL: 'email',
};

let connection = null;
let queue = null;
let queueScheduler = null;

/**
 * Create (and memoise) an ioredis connection for BullMQ, honouring the same
 * TLS configuration used by the cache client. Returns null when Redis is
 * disabled.
 */
export function getConnection() {
  if (!REDIS_URL) return null;
  if (connection) return connection;
  const tlsOptions = buildTlsOptions();
  connection = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // BullMQ requires this to be null/undefined
    enableOfflineQueue: false,
    ...(tlsOptions && { tls: tlsOptions }),
  });
  connection.on('error', () => {}); // suppress unhandled error events
  return connection;
}

/**
 * Return (and lazily create) the shared BullMQ Queue.
 */
export function getQueue() {
  const conn = getConnection();
  if (!conn) return null;
  if (queue) return queue;

  queue = new Queue(QUEUE_NAME, { connection: conn });
  return queue;
}

/**
 * Initialise the dedicated queue scheduler (recurring jobs) once.
 * Safe to call multiple times.
 */
export function initQueueScheduler() {
  const conn = getConnection();
  if (!conn || queueScheduler) return null;
  try {
    // Deprecated in BullMQ v5 but functional; guarded so a future major version
    // that removes it cannot crash startup.
    queueScheduler = new QueueScheduler(QUEUE_NAME, { connection: conn });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[jobs] QueueScheduler unavailable:', err.message);
    return null;
  }
  return queueScheduler;
}

/**
 * Enqueue an email notification job. Falls back to a fire-and-forget inline
 * send when BullMQ/Redis is unavailable.
 *
 * @param {{ type: string, to: string, variables?: object }} emailData
 */
export async function enqueueEmail(emailData) {
  const q = getQueue();
  if (!q) {
    // Fallback: process inline so email still gets sent without Redis.
    const { emailService } = await import('../email.js');
    return emailService.queue(emailData);
  }
  await q.add(JOB_NAMES.EMAIL, emailData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 500,
  });
}

/**
 * Queue statistics for health/admin endpoints.
 */
export async function getQueueStats() {
  const q = getQueue();
  if (!q) {
    return { enabled: false, counts: null };
  }
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    q.count('waiting'),
    q.count('active'),
    q.count('completed'),
    q.count('failed'),
    q.count('delayed'),
  ]);
  return { enabled: true, counts: { waiting, active, completed, failed, delayed } };
}

/**
 * Close the queue and connection (mainly for tests / graceful shutdown).
 */
export async function closeQueue() {
  if (queue) await queue.close();
  if (queueScheduler) await queueScheduler.close();
  if (connection) await connection.quit();
  queue = null;
  queueScheduler = null;
  connection = null;
}