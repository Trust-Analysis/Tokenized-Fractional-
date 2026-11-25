// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Verify an admin API key without a content-based timing signal.
 * Hashing both values first ensures timingSafeEqual always receives equal-length buffers.
 */
export function verifyAdminKey(
  req,
  candidate = req?.headers?.['x-api-key'],
  expectedKey = process.env.ADMIN_API_KEY,
) {
  if (typeof candidate !== 'string' || typeof expectedKey !== 'string' || !candidate || !expectedKey) {
    return false;
  }

  const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expectedKey, 'utf8').digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}
