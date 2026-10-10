import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook, waitFor, fireEvent } from '@testing-library/react';
import { Networks } from '@stellar/stellar-sdk';

vi.mock('@stellar/freighter-api', () => ({
  getNetwork: vi.fn(),
}));

import { getNetwork } from '@stellar/freighter-api';
import {
  normalizeNetwork,
  networksMatch,
  networkLabel,
  walletNetworkLabel,
} from '../utils/networkMismatch';
import NetworkMismatchBanner from '../components/NetworkMismatchBanner';
import useNetworkMismatch from '../hooks/useNetworkMismatch';

const MAINNET_PASSPHRASE = Networks.PUBLIC;
const TESTNET_PASSPHRASE = Networks.TESTNET;

describe('networkMismatch helpers (Issue #714)', () => {
  it('normalises passphrases, labels and Freighter API objects', () => {
    expect(normalizeNetwork(TESTNET_PASSPHRASE)).toBe('testnet');
    expect(normalizeNetwork('TESTNET')).toBe('testnet');
    expect(normalizeNetwork(MAINNET_PASSPHRASE)).toBe('mainnet');
    expect(normalizeNetwork('MAINNET')).toBe('mainnet');
    expect(normalizeNetwork({ network: 'TESTNET' })).toBe('testnet');
    expect(normalizeNetwork(undefined)).toBe('');
  });

  it('treats an unknown wallet network as a match so we never block blindly', () => {
    expect(networksMatch(undefined, TESTNET_PASSPHRASE)).toBe(true);
    expect(networksMatch(null, TESTNET_PASSPHRASE)).toBe(true);
  });

  it('compares the Freighter network against the configured passphrase', () => {
    expect(networksMatch(TESTNET_PASSPHRASE, TESTNET_PASSPHRASE)).toBe(true);
    expect(networksMatch('TESTNET', TESTNET_PASSPHRASE)).toBe(true);
    expect(networksMatch(MAINNET_PASSPHRASE, TESTNET_PASSPHRASE)).toBe(false);
    expect(networksMatch(MAINNET_PASSPHRASE, MAINNET_PASSPHRASE)).toBe(true);
  });

  it('produces readable labels', () => {
    expect(networkLabel(TESTNET_PASSPHRASE)).toBe('Testnet');
    expect(networkLabel(MAINNET_PASSPHRASE)).toBe('Mainnet');
    expect(walletNetworkLabel('MAINNET')).toBe('Mainnet');
    expect(walletNetworkLabel(TESTNET_PASSPHRASE)).toBe('Testnet');
    expect(walletNetworkLabel(undefined)).toBe('an unknown network');
  });
});

describe('NetworkMismatchBanner (Issue #714)', () => {
  it('renders an actionable warning when there is a mismatch', () => {
    const onRetry = vi.fn();
    render(
      <NetworkMismatchBanner
        mismatch
        expected="Testnet"
        walletNetwork="MAINNET"
        onRetry={onRetry}
      />,
    );

    const banner = screen.getByTestId('network-mismatch-banner');
    expect(banner).toHaveTextContent('Wrong network');
    expect(banner).toHaveTextContent(/Mainnet/);
    expect(banner).toHaveTextContent(/expects Testnet/);
    expect(banner).toHaveTextContent(/switch it to Testnet/i);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the networks match', () => {
    const { container } = render(
      <NetworkMismatchBanner mismatch={false} expected="Testnet" walletNetwork="TESTNET" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('useNetworkMismatch (Issue #714)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags a mismatch when Freighter is on a different network', async () => {
    getNetwork.mockResolvedValue('MAINNET');
    const { result } = renderHook(() => useNetworkMismatch());

    await waitFor(() => expect(result.current.mismatch).toBe(true));
    expect(result.current.expected).toBe('Testnet');
  });

  it('does not block when Freighter matches the configured network', async () => {
    getNetwork.mockResolvedValue('TESTNET');
    const { result } = renderHook(() => useNetworkMismatch());

    await waitFor(() => expect(getNetwork).toHaveBeenCalled());
    await waitFor(() => expect(result.current.mismatch).toBe(false));
  });
});
