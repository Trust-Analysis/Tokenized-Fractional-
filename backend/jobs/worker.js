// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Background job Worker process (Issue #569).
 *
 * Run as a dedicated process so heavy tasks (email dispatch, price aggregation,
 * etc.) never block the main API event loop:
 *
 *   node jobs/worker.js
 *
 * Gracefully shuts down on SIGTERM/SIGINT so in-flight jobs are not lost.
 */

import { Worker } from 'bullmq';
import { getConnection, initQueueScheduler, JOB_NAMES, QUEUE_NAME } from './queue.js';
import { processEmailJob } from './processEmail.js';

const conn = getConnection();

function start() {
  if (!conn) {
    // eslint-disable-next-line no-console
    console.warn(
      '[worker] REDIS_URL not configured — worker not started. ' +
        'Background jobs are falling back to inline processing.',
    );
    return null;
  }

  initQueueScheduler();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case JOB_NAMES.EMAIL:
          return processEmailJob(job);
        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }
    },
    {
      connection: conn,
      concurrency: Number(process.env.WORKER_CONCURRENCY || 5),
      limiter: {
        max: Number(process.env.WORKER_RATE_LIMIT_MAX || 20),
        duration: Number(process.env.WORKER_RATE_LIMIT_DURATION || 1000),
      },
    },
  );

  worker.on('completed', (job) => {
    // eslint-disable-next-line no-console
    console.log(`[worker] completed ${job.name} ${job.id}`);
  });
  worker.on('failed', (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[worker] failed ${job?.name} ${job?.id}:`, err.message);
  });
  worker.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[worker] error:', err.message);
  });

  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('[worker] shutting down…');
    await worker.close();
    if (conn) await conn.quit();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return worker;
}

start();