import { describe, it, expect, beforeEach } from '@jest/globals';
import { IndexingEngine, setReorgInProgress } from '../src/services/indexingEngine.js';
import { reorgGuardMiddleware } from '../src/middleware/reorgGuard.js';

describe('Issue #416: Implement seamless ledger re-org handling in the indexing engine', () => {
  let engine;

  beforeEach(() => {
    engine = new IndexingEngine();
    setReorgInProgress(false);
  });

  it('tracks ledger_hash and previous_ledger_hash in the database history', async () => {
    await engine.processLedgerBlock({
      sequence: 100,
      ledger_hash: 'hash_100',
      previous_ledger_hash: 'hash_099',
      events: [{ id: 'evt_1', type: 'PURCHASE', shares: 5 }],
    });

    const history = engine.getLedgerHistory();
    expect(history.length).toBe(1);
    expect(history[0].ledger_hash).toBe('hash_100');
    expect(history[0].previous_ledger_hash).toBe('hash_099');

    const events = engine.getEvents();
    expect(events.length).toBe(1);
    expect(events[0].ledger_hash).toBe('hash_100');
  });

  it('detects chain divergence and purges invalid database rows back to common ancestor', async () => {
    // 1. Process canonical blocks 101 and 102
    await engine.processLedgerBlock({
      sequence: 101,
      ledger_hash: 'hash_101',
      previous_ledger_hash: 'hash_100_parent',
      events: [{ id: 'evt_101', type: 'PURCHASE' }],
    });

    await engine.processLedgerBlock({
      sequence: 102,
      ledger_hash: 'orphan_hash_102',
      previous_ledger_hash: 'hash_101',
      events: [{ id: 'evt_102_phantom', type: 'PURCHASE' }],
    });

    expect(engine.getEvents().length).toBe(2);

    // 2. Incoming block 103 points to a different previous hash (Re-org!)
    const divergentBlock = {
      sequence: 102, // Fork replacement block 102
      ledger_hash: 'canonical_hash_102',
      previous_ledger_hash: 'hash_101', // Common ancestor is block 101
      events: [{ id: 'evt_102_canonical', type: 'PURCHASE' }],
    };

    const reorgResult = await engine.handleLedgerReorg(divergentBlock);

    expect(reorgResult.status).toBe('REORG_HANDLED');
    expect(reorgResult.commonAncestorSeq).toBe(101);

    // Phantom event from orphaned block 102 must be purged
    const events = engine.getEvents();
    const eventIds = events.map((e) => e.id);

    expect(eventIds).toContain('evt_101');
    expect(eventIds).toContain('evt_102_canonical');
    expect(eventIds).not.toContain('evt_102_phantom');
  });

  it('client APIs return HTTP 503 Service Unavailable during re-org rollback', () => {
    setReorgInProgress(true);

    const req = {};
    let statusCode = null;
    let jsonBody = null;

    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (body) => {
            jsonBody = body;
          },
        };
      },
    };

    const next = jest.fn();

    reorgGuardMiddleware(req, res, next);

    expect(statusCode).toBe(503);
    expect(jsonBody.error).toBe('Service Unavailable');
    expect(jsonBody.code).toBe('REORG_IN_PROGRESS');
    expect(next).not.toHaveBeenCalled();
  });

  it('client APIs return HTTP 200 / proceed normal execution post re-org recovery', () => {
    setReorgInProgress(false);

    const req = {};
    const res = {};
    const next = jest.fn();

    reorgGuardMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
