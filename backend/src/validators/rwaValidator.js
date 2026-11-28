// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/validators/rwaValidator.js — validation helpers for RWA asset and webhook requests.
 */

import { rwaFields } from './rwaFields.js';
import { StrKey } from '@stellar/stellar-sdk';
import { WEBHOOK_VALID_EVENTS } from '../config.js';

export const INVALID_CONTRACT_ID_MESSAGE =
  'Invalid contract ID: expected a 56-character Stellar contract strkey starting with C (with a valid checksum).';

/**
 * Validate a deployed Soroban contract address: 56 chars, C prefix and a valid
 * strkey checksum. Shared by every REST and GraphQL asset-creation path.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
export function isValidContractId(id) {
  return (
    typeof id === 'string' &&
    id.length === 56 &&
    /^C[A-Z2-7]{55}$/.test(id) &&
    StrKey.isValidContract(id)
  );
}

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
export function validateRwaBody(body, { partial = false } = {}) {
  const missing = Object.entries(rwaFields)
    .filter(([name, rule]) => rule.required && (!partial || Object.prototype.hasOwnProperty.call(body ?? {}, name)) && (body?.[name] == null ||
      (typeof body[name] === 'string' && body[name].trim() === '')))
    .map(([name]) => name);
  if (missing.length > 0) return `Missing required fields: ${missing.join(', ')}`;
  for (const [name, rule] of Object.entries(rwaFields)) {
    const value = body[name];
    if (value == null) continue;
    if (rule.type === 'String' && typeof value !== 'string') return `${name} must be a string`;
    if (rule.type === 'Int' && (!Number.isInteger(value) || value < rule.min || value > 2147483647)) {
      return `${name} must be an integer between ${rule.min} and 2147483647`;
    }
  }
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
  const invalid = body.events.filter(e => !WEBHOOK_VALID_EVENTS.includes(e));
  if (invalid.length > 0) {
    return `Invalid events: ${invalid.join(', ')}. Valid: ${WEBHOOK_VALID_EVENTS.join(', ')}`;
  }
  return null;
}
