import { describe, it, expect } from 'vitest';
import {
  ERROR_CATEGORIES,
  ERROR_CATALOG,
  extractContractErrorCode,
  extractRawMessage,
  getErrorMessage,
  getErrorMessageWithNextStep,
  isKnownError,
  mapError,
  toToastError,
} from '../lib/errorMapper';
import { GENERIC_ERROR_MESSAGE } from '../constants/errors';

describe('Issue #720: raw RPC/contract error messages are translated for end users', () => {
  describe('paused errors', () => {
    it('maps the global "Marketplace is paused" panic to friendly copy with a next step', () => {
      const mapped = mapError(new Error('Marketplace is paused'), { operation: 'buy_shares' });

      expect(mapped.code).toBe('MARKETPLACE_PAUSED');
      expect(mapped.isKnown).toBe(true);
      expect(mapped.category).toBe(ERROR_CATEGORIES.PAUSED);
      expect(mapped.operation).toBe('buy_shares');
      expect(mapped.message).toBe('Marketplace is currently paused. Try again later.');
      expect(mapped.nextStep).toMatch(/operator/i);
    });

    it('maps the granular "Purchases are currently paused" panic to its own copy', () => {
      const mapped = mapError(new Error('Purchases are currently paused'));

      expect(mapped.code).toBe('PURCHASES_PAUSED');
      expect(mapped.message).toBe('Buying shares is temporarily paused.');
      expect(mapped.nextStep).toMatch(/selling and transfers are unaffected/i);
      // The raw string must never leak into the user-facing copy.
      expect(mapped.message).not.toContain('paused".');
    });

    it('matches paused errors case-insensitively and regardless of wrapping', () => {
      const mapped = mapError(new Error('HostError: Error(Contract, #1, Marketplace Is Paused)'));

      expect(mapped.code).toBe('MARKETPLACE_PAUSED');
    });

    it('does not leak the raw panic text into the toast payload for known errors', () => {
      const toast = toToastError(new Error('Marketplace is paused'), { operation: 'buy_shares' });

      expect(toast.type).toBe('warning');
      expect(toast.message).toBe('Marketplace is currently paused. Try again later.');
      expect(toast.nextSteps).toBeTruthy();
      expect(toast.details).toBeUndefined();
    });
  });

  describe('insufficient shares errors', () => {
    it('maps "Not enough shares available for purchase" to the specific buy copy', () => {
      const mapped = mapError(new Error('Not enough shares available for purchase'));

      expect(mapped.code).toBe('INSUFFICIENT_AVAILABLE_SHARES');
      expect(mapped.category).toBe(ERROR_CATEGORIES.INSUFFICIENT_SHARES);
      expect(mapped.message).toContain('Not enough shares available.');
      expect(mapped.nextStep).toMatch(/smaller number of shares/i);
    });

    it('maps other insufficient-share panics to the generic shares copy', () => {
      const mapped = mapError(new Error('Insufficient shares to transfer'));

      expect(mapped.code).toBe('INSUFFICIENT_SHARES');
      expect(mapped.message).toBe('You do not have enough shares for this action.');
      expect(mapped.nextStep).toMatch(/reduce the amount/i);
    });

    it('prefers the more specific purchase pattern over the generic one', () => {
      expect(mapError(new Error('Not enough shares available for purchase')).code).not.toBe(
        'INSUFFICIENT_SHARES',
      );
    });
  });

  describe('insufficient balance errors', () => {
    it('maps a low-level "insufficient balance" failure to actionable copy', () => {
      const mapped = mapError(new Error('insufficient balance'));

      expect(mapped.code).toBe('INSUFFICIENT_BALANCE');
      expect(mapped.category).toBe(ERROR_CATEGORIES.INSUFFICIENT_FUNDS);
      expect(mapped.message).toBe(
        'Your wallet does not have enough balance to cover this transaction.',
      );
      expect(mapped.nextStep).toMatch(/payment token/i);
      expect(mapped.nextStep).toMatch(/network fees/i);
    });

    it('maps the Soroban tx_insufficient_balance result code', () => {
      expect(mapError(new Error('tx_insufficient_balance')).code).toBe('INSUFFICIENT_BALANCE');
    });

    it('maps the Stellar op_underfunded result code', () => {
      expect(mapError(new Error('op_underfunded')).code).toBe('INSUFFICIENT_BALANCE');
    });

    it('maps a bridge liquidity shortfall to the balance copy', () => {
      expect(mapError(new Error('Insufficient liquid balance to lock for bridge')).code).toBe(
        'INSUFFICIENT_BALANCE',
      );
    });
  });

  describe('contract error codes', () => {
    it('decodes a host error into the friendly copy for that contract error code', () => {
      const mapped = mapError(new Error('HostError: Error(Contract, #8)'));

      expect(mapped.code).toBe('INSUFFICIENT_SHARES');
      expect(mapped.isKnown).toBe(true);
      expect(mapped.message).toBe('You do not have enough shares for this action.');
    });

    it('extracts the numeric code from both host error shapes', () => {
      expect(extractContractErrorCode('HostError: Error(Contract, #17)')).toBe(17);
      expect(extractContractErrorCode('HostError: #4')).toBe(4);
      expect(extractContractErrorCode('Marketplace is paused')).toBeNull();
    });

    it('falls through to the generic copy for an unknown contract error code', () => {
      const mapped = mapError(new Error('HostError: Error(Contract, #999)'));

      expect(mapped.isKnown).toBe(false);
      expect(mapped.message).toBe(GENERIC_ERROR_MESSAGE);
    });
  });

  describe('unrecognised errors fall back to generic copy with the raw error retained', () => {
    it('uses the generic message and keeps the raw error available on expand', () => {
      const toast = toToastError(new Error('soroban exploded: segfault at 0xdeadbeef'));

      expect(toast.message).toBe('Something went wrong — see details');
      expect(toast.type).toBe('error');
      expect(toast.nextSteps).toMatch(/contact support/i);
      expect(toast.details).toBe('soroban exploded: segfault at 0xdeadbeef');
    });

    it('marks the fallback as unknown and preserves the raw string on the mapped error', () => {
      const mapped = mapError(new Error('something nobody has seen before'));

      expect(mapped.isKnown).toBe(false);
      expect(mapped.code).toBe('UNKNOWN_ERROR');
      expect(mapped.category).toBe(ERROR_CATEGORIES.UNKNOWN);
      expect(mapped.message).toBe(GENERIC_ERROR_MESSAGE);
      expect(mapped.raw).toBe('something nobody has seen before');
    });

    it('handles null, undefined and non-Error values without throwing', () => {
      for (const value of [null, undefined, 42, {}, []]) {
        const mapped = mapError(value);
        expect(mapped.message).toBe(GENERIC_ERROR_MESSAGE);
        expect(mapped.isKnown).toBe(false);
      }
    });

    it('omits the details disclosure when there is no raw text to show', () => {
      expect(toToastError(null).details).toBeUndefined();
    });
  });

  describe('raw error extraction', () => {
    it('reads plain strings, Error messages and nested RPC response shapes', () => {
      expect(extractRawMessage('Marketplace is paused')).toBe('Marketplace is paused');
      expect(extractRawMessage(new Error('Marketplace is paused'))).toBe('Marketplace is paused');
      expect(extractRawMessage({ error: 'Marketplace is paused' })).toBe('Marketplace is paused');
      expect(extractRawMessage({ cause: { message: 'Marketplace is paused' } })).toBe(
        'Marketplace is paused',
      );
    });

    it('returns an empty string when there is nothing readable', () => {
      expect(extractRawMessage(null)).toBe('');
      expect(extractRawMessage({})).toBe('');
    });
  });

  describe('network and RPC errors', () => {
    it('maps the "TypeError: Failed to fetch" case from docs/troubleshooting.md', () => {
      const mapped = mapError(new TypeError('Failed to fetch'));

      expect(mapped.code).toBe('RPC_UNREACHABLE');
      expect(mapped.message).toBe('We could not reach the Stellar network.');
      expect(mapped.nextStep).toMatch(/internet connection/i);
    });

    it('maps rate limiting and unavailability to retry guidance', () => {
      expect(mapError(new Error('Request failed with status 429')).code).toBe('RPC_RATE_LIMITED');
      expect(mapError(new Error('503 Service Unavailable')).code).toBe('RPC_UNAVAILABLE');
    });

    it('maps a pending-transaction timeout to a "wait" message', () => {
      const mapped = mapError(new Error('Transaction submitted but result not available (timeout)'));

      expect(mapped.code).toBe('RPC_TIMEOUT');
      expect(mapped.message).toBe('The network took too long to respond.');
    });
  });

  describe('convenience helpers', () => {
    it('returns only the headline copy from getErrorMessage', () => {
      expect(getErrorMessage(new Error('Marketplace is paused'))).toBe(
        'Marketplace is currently paused. Try again later.',
      );
    });

    it('joins the headline and the next step in getErrorMessageWithNextStep', () => {
      const headline = getErrorMessage(new Error('Not enough shares available for purchase'));
      const combined = getErrorMessageWithNextStep(
        new Error('Not enough shares available for purchase'),
      );

      expect(combined.startsWith(headline)).toBe(true);
      expect(combined).toMatch(/smaller number of shares/i);
    });

    it('reports whether an error was recognised', () => {
      expect(isKnownError(new Error('Marketplace is paused'))).toBe(true);
      expect(isKnownError(new Error('totally novel failure'))).toBe(false);
    });
  });

  describe('catalog integrity', () => {
    it('declares copy and a next step for every catalog entry', () => {
      for (const entry of ERROR_CATALOG) {
        expect(entry.code, `${entry.code} needs a code`).toBeTruthy();
        expect(entry.message, `${entry.code} needs user-facing copy`).toBeTruthy();
        expect(entry.nextStep, `${entry.code} needs a suggested next step`).toBeTruthy();
        expect(entry.patterns.length, `${entry.code} needs at least one pattern`).toBeGreaterThan(0);
      }
    });

    it('uses unique codes and lowercase patterns', () => {
      const codes = ERROR_CATALOG.map((entry) => entry.code);
      expect(new Set(codes).size).toBe(codes.length);

      for (const entry of ERROR_CATALOG) {
        for (const pattern of entry.patterns) {
          expect(pattern).toBe(pattern.toLowerCase());
        }
      }
    });
  });
});
