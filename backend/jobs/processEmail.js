// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Email background-job processor (Issue #569).
 *
 * Executes the heavy work — rendering MJML/Handlebars templates and handing
 * delivery to the SMTP transporter — off the main request event loop. The job
 * payload is created by `enqueueEmail()` in `queue.js`.
 */

import { emailService } from '../email.js';

/**
 * @param {import('bullmq').Job} job
 */
export async function processEmailJob(job) {
  const { type, to, variables = {} } = job.data;
  const emailData = { type, to, variables };
  await emailService.send(emailData);
  return { type, to };
}