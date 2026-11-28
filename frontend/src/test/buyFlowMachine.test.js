import { describe, it, expect } from 'vitest';
import {
  BuyFlowState,
  BuyFlowEvent,
  buyFlowReducer,
  createInitialBuyFlowState,
  isBuyFlowOpen,
} from '../machines/buyFlowMachine.js';

/**
 * Issue #718 — the buy-flow state machine extracted from `BuyShares.jsx`.
 * These tests assert the happy path, every failure/rollback transition and the
 * "impossible state" guards that motivated the extraction.
 */
describe('Buy-flow state machine (#718)', () => {
  it('starts idle with no transaction hash or error', () => {
    expect(createInitialBuyFlowState()).toEqual({
      status: BuyFlowState.IDLE,
      txHash: null,
      error: null,
    });
  });

  it('mounts the confirmation modal when the user reviews the purchase', () => {
    const initial = createInitialBuyFlowState();
    expect(isBuyFlowOpen(initial)).toBe(false);

    const reviewing = buyFlowReducer(initial, { type: BuyFlowEvent.REVIEW });
    expect(reviewing.status).toBe(BuyFlowState.CONFIRMING);
    expect(isBuyFlowOpen(reviewing)).toBe(true);
  });

  it('moves confirming → processing on confirm, clearing any stale error/hash', () => {
    const confirming = { status: BuyFlowState.CONFIRMING, txHash: '0xstale', error: 'stale' };
    const processing = buyFlowReducer(confirming, { type: BuyFlowEvent.CONFIRM });

    expect(processing).toEqual({ status: BuyFlowState.PROCESSING, txHash: null, error: null });
  });

  it('records the transaction hash on success', () => {
    const processing = { status: BuyFlowState.PROCESSING, txHash: null, error: null };
    const success = buyFlowReducer(processing, {
      type: BuyFlowEvent.SUCCEEDED,
      payload: { txHash: '0xabc' },
    });

    expect(success.status).toBe(BuyFlowState.SUCCESS);
    expect(success.txHash).toBe('0xabc');
    expect(success.error).toBeNull();
  });

  it('records the failure reason on error', () => {
    const processing = { status: BuyFlowState.PROCESSING, txHash: null, error: null };
    const failed = buyFlowReducer(processing, {
      type: BuyFlowEvent.FAILED,
      payload: { error: 'Soroban transaction failed' },
    });

    expect(failed.status).toBe(BuyFlowState.ERROR);
    expect(failed.error).toBe('Soroban transaction failed');
    expect(failed.txHash).toBeNull();
  });

  it('falls back to a generic message when a failure carries no reason', () => {
    const processing = { status: BuyFlowState.PROCESSING, txHash: null, error: null };
    const failed = buyFlowReducer(processing, { type: BuyFlowEvent.FAILED });

    expect(failed.error).toBe('Transaction failed or rejected by network.');
  });

  it('allows retrying a failed transaction straight from the error state', () => {
    const failed = { status: BuyFlowState.ERROR, txHash: null, error: 'boom' };
    const retrying = buyFlowReducer(failed, { type: BuyFlowEvent.CONFIRM });

    expect(retrying).toEqual({ status: BuyFlowState.PROCESSING, txHash: null, error: null });
  });

  it('closes the modal from confirming / success / error back to idle', () => {
    const cancel = { type: BuyFlowEvent.CANCEL };
    const closed = createInitialBuyFlowState();

    expect(
      buyFlowReducer({ status: BuyFlowState.CONFIRMING, txHash: null, error: null }, cancel),
    ).toEqual(closed);
    expect(
      buyFlowReducer({ status: BuyFlowState.SUCCESS, txHash: '0xabc', error: null }, cancel),
    ).toEqual(closed);
    expect(
      buyFlowReducer({ status: BuyFlowState.ERROR, txHash: null, error: 'boom' }, cancel),
    ).toEqual(closed);
  });

  it('never discards an in-flight transaction: CANCEL/RESET are no-ops while processing', () => {
    const processing = { status: BuyFlowState.PROCESSING, txHash: null, error: null };

    expect(buyFlowReducer(processing, { type: BuyFlowEvent.CANCEL })).toBe(processing);
    expect(buyFlowReducer(processing, { type: BuyFlowEvent.RESET })).toBe(processing);
  });

  it('ignores illegal and unknown events instead of entering an undefined state', () => {
    const idle = createInitialBuyFlowState();

    expect(buyFlowReducer(idle, { type: BuyFlowEvent.CONFIRM })).toBe(idle);
    expect(buyFlowReducer(idle, { type: BuyFlowEvent.SUCCEEDED })).toBe(idle);
    expect(buyFlowReducer(idle, { type: BuyFlowEvent.FAILED })).toBe(idle);
    expect(buyFlowReducer(idle, { type: 'NOT_A_REAL_EVENT' })).toBe(idle);
    expect(buyFlowReducer(idle, {})).toBe(idle);
  });

  it('keeps processing and success mutually exclusive via the single status field', () => {
    const success = buyFlowReducer(
      { status: BuyFlowState.PROCESSING, txHash: null, error: null },
      { type: BuyFlowEvent.SUCCEEDED, payload: { txHash: '0xabc' } },
    );

    expect(success.status).toBe(BuyFlowState.SUCCESS);
    expect(success.status === BuyFlowState.PROCESSING).toBe(false);
  });
});
