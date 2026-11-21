import { describe, it, expect, vi } from 'vitest';
import { copyTextToClipboard, truncateAddress } from '../utils/walletAddress';

const FULL_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234';

describe('truncateAddress', () => {
  it('keeps the head and tail and inserts an ellipsis', () => {
    expect(truncateAddress(FULL_KEY, 6, 6)).toBe(`${FULL_KEY.slice(0, 6)}…${FULL_KEY.slice(-6)}`);
  });

  it('returns short addresses unchanged', () => {
    expect(truncateAddress('GABC')).toBe('GABC');
  });

  it('handles empty / non-string input', () => {
    expect(truncateAddress('')).toBe('');
    expect(truncateAddress(null)).toBe('');
    expect(truncateAddress(undefined)).toBe('');
    expect(truncateAddress(42)).toBe('');
  });
});

describe('copyTextToClipboard', () => {
  it('uses the async Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const navigatorRef = { clipboard: { writeText } };

    const result = await copyTextToClipboard('hello', { navigatorRef });

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to the legacy textarea path when the Clipboard API is missing', async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const body = {
      appendChild: vi.fn((el) => el),
      removeChild: vi.fn(),
    };
    const documentRef = {
      body,
      createElement: vi.fn(() => ({ select: vi.fn(), setAttribute: vi.fn(), style: {} })),
      execCommand,
    };

    const result = await copyTextToClipboard('fallback', {
      navigatorRef: {},
      documentRef,
    });

    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false for empty input', async () => {
    await expect(copyTextToClipboard('', { navigatorRef: {} })).resolves.toBe(false);
  });

  it('falls back when Clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const execCommand = vi.fn().mockReturnValue(true);
    const documentRef = {
      body: { appendChild: vi.fn((el) => el), removeChild: vi.fn() },
      createElement: vi.fn(() => ({ select: vi.fn(), setAttribute: vi.fn(), style: {} })),
      execCommand,
    };

    const result = await copyTextToClipboard('x', {
      navigatorRef: { clipboard: { writeText } },
      documentRef,
    });

    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalled();
  });
});
