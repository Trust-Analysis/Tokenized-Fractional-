// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/anomalyDetector.test.js — Accuracy of the request anomaly detector
 * against a labelled dataset, and that a flag is enforced (issue #903).
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AnomalyDetector } from '../src/services/anomalyDetector.js';
import { RateLimiterService } from '../src/services/rateLimiterService.js';
import { buildDataset, START } from './fixtures/anomalyDataset.js';

// Documented minimum bar — keep in sync with docs/ANOMALY_DETECTION.md.
const MIN_TRUE_POSITIVE_RATE = 0.9;
const MAX_FALSE_POSITIVE_RATE = 0.05;

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function newDetector(clock) {
  const detector = new AnomalyDetector({ logger: silentLogger, now: () => clock.now });
  detector.enabled = true; // independent of ANOMALY_DETECTION_ENABLED
  return detector;
}

/** Replays a scenario in timestamp order; returns whether any request was flagged. */
async function replay(events) {
  const clock = { now: START };
  const detector = newDetector(clock);
  const ordered = [...events].sort((a, b) => a.at - b.at);
  let flagged = false;
  for (const event of ordered) {
    clock.now = (event.start ?? START) + event.at;
    const result = await detector.check(event);
    if (result.blocked) flagged = true;
  }
  return flagged;
}

describe('AnomalyDetector — labelled dataset', () => {
  const dataset = buildDataset();
  const results = [];

  beforeAll(async () => {
    for (const scenario of dataset) {
      results.push({ ...scenario, flagged: await replay(scenario.events) });
    }
  });

  test('dataset has enough samples of each label to be meaningful', () => {
    expect(dataset.filter((s) => s.label === 'normal').length).toBeGreaterThanOrEqual(15);
    expect(dataset.filter((s) => s.label === 'suspicious').length).toBeGreaterThanOrEqual(15);
  });

  test(`true-positive rate on suspicious traffic is at least ${MIN_TRUE_POSITIVE_RATE}`, () => {
    const suspicious = results.filter((r) => r.label === 'suspicious');
    const missed = suspicious.filter((r) => !r.flagged).map((r) => r.name);
    const tpr = (suspicious.length - missed.length) / suspicious.length;
    expect(tpr).toBeGreaterThanOrEqual(MIN_TRUE_POSITIVE_RATE);
  });

  test(`false-positive rate on normal traffic is at most ${MAX_FALSE_POSITIVE_RATE}`, () => {
    const normal = results.filter((r) => r.label === 'normal');
    const falsePositives = normal.filter((r) => r.flagged).map((r) => r.name);
    const fpr = falsePositives.length / normal.length;
    expect(fpr).toBeLessThanOrEqual(MAX_FALSE_POSITIVE_RATE);
  });

  test.each(buildDataset().map((s) => [s.name, s.label, s.events]))(
    '%s (%s) is classified correctly',
    async (_name, label, events) => {
      expect(await replay(events)).toBe(label === 'suspicious');
    },
  );
});

describe('AnomalyDetector — behaviour', () => {
  test('a client is let through again once its burst has aged out', async () => {
    const clock = { now: START };
    const detector = newDetector(clock);
    const req = { ip: '233.252.0.9', apiKey: 'k', userAgent: 'x', path: '/assets', method: 'GET' };

    let last;
    for (let i = 0; i < 150; i++) last = await detector.check(req);
    expect(last.blocked).toBe(true);
    expect(last.reasons).toContain('burst_rate_anomaly');

    clock.now += 60_000;
    expect((await detector.check(req)).blocked).toBe(false);
  });

  test('does nothing when disabled', async () => {
    const detector = newDetector({ now: START });
    detector.enabled = false;
    expect(await detector.check({ ip: 'a' })).toEqual({ blocked: false, confidence: 0 });
  });
});

describe('AnomalyDetector — action taken on a flag', () => {
  const services = [];
  afterAll(() => services.forEach((s) => s.destroy()));

  test('RateLimiterService rejects the request with 429 and logs it to analytics', async () => {
    const clock = { now: START };
    const logged = [];
    const analytics = {
      logBlocked: async (entry) => logged.push(entry),
      logRequest: async () => {},
    };
    const service = new RateLimiterService({
      logger: silentLogger,
      analytics,
      anomalyDetector: newDetector(clock),
    });
    services.push(service);
    service.configureApiKey('flood-key', 'enterprise');

    let result;
    for (let i = 0; i < 150; i++) {
      result = await service.checkRateLimit('flood-key', {
        ip: '233.252.0.10',
        userAgent: 'x',
        path: '/assets',
        method: 'GET',
      });
      if (!result.allowed) break;
    }

    expect(result).toMatchObject({
      allowed: false,
      status: 429,
      reason: 'anomaly_detected',
      retryAfter: 300,
    });
    expect(logged).toEqual([
      expect.objectContaining({ reason: 'anomaly_detected', ip: '233.252.0.10' }),
    ]);
  });
});
