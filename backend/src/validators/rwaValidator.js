// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/validators/rwaValidator.js — validation helpers for RWA asset and webhook requests.
 */

import { WEBHOOK_VALID_EVENTS } from '../config.js';

/**
 * Validate a Soroban contract ID.
 * Must start with 'C' and be at least 50 characters.
 *
 * @param {string} id
 * @returns {boolean}
 */
export function validateContractId(id) {
  return typeof id === 'string' && id.length >= 50 && id.startsWith('C');
}

/**
 * Validate the body of a create/update RWA asset request.
 *
 * @param {object} body
 * @returns {string|null} Error message or null if valid
 */
export function validateRwaBody(body) {
  const required = ['title', 'location', 'description', 'assetType'];
  const missing = required.filter((f) => !body[f]);
  if (missing.length > 0) return `Missing required fields: ${missing.join(', ')}`;
  return null;
}

/**
 * Validate the body of a webhook registration request.
 *
 * @param {object} body
 * @returns {string|null} Error message or null if valid
 */
export function validateWebhookBody(body) {
  if (!body.url || typeof body.url !== 'string') return 'url is required';
  try {
    new URL(body.url);
  } catch {
    return 'url must be a valid URL';
  }
  if (!Array.isArray(body.events) || body.events.length === 0) {
    return 'events must be a non-empty array';
  }
  const invalid = body.events.filter((e) => !WEBHOOK_VALID_EVENTS.includes(e));
  if (invalid.length > 0) {
    return `Invalid events: ${invalid.join(', ')}. Valid: ${WEBHOOK_VALID_EVENTS.join(', ')}`;
  }
  return null;
}
