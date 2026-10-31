import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { setAllowed, getUserInfo, getNetwork } from '@stellar/freighter-api';
import { FreighterWalletProvider, useFreighterWallet } from '../context/FreighterWalletContext.jsx';

// Issue #718: the Freighter extension is never touched — the whole API surface
// the wallet hook depends on is mocked at the module boundary.
vi.mock('@stellar/freighter-api', () => ({
  isAllowed: vi.fn(async () => false),
  setAllowed: vi.fn(async () => undefined),
  getUserInfo: vi.fn(async () => ({ publicKey: null })),
  getNetwork: vi.fn(async () => 'TESTNET'),
}));

const PUBLIC_KEY = 'GBAZE64FKVPG4JUUP2BH63746JJ22G3A2S4QPF4UWKVA2RELLFLQZQVR';

function renderWallet() {
  const wrapper = ({ children }) => (
    <FreighterWalletProvider expectedNetwork="TESTNET">{children}</FreighterWalletProvider>
  );

  return renderHook(() => useFreighterWallet(), { wrapper });
}

describe('Freighter wallet connection hook (#718)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_MOCK_WALLET', 'false');
    setAllowed.mockResolvedValue(undefined);
    getUserInfo.mockResolvedValue({ publicKey: PUBLIC_KEY });
    getNetwork.mockResolvedValue('TESTNET');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('starts in the disconnected state', () => {
    const { result } = renderWallet();

    expect(result.current.isDisconnected).toBe(true);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.publicKey).toBeNull();
    expect(result.current.walletError).toBeNull();
  });

  it('connects through Freighter and stores the public key', async () => {
    const { result } = renderWallet();

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(setAllowed).toHaveBeenCalledTimes(1);
    expect(getUserInfo).toHaveBeenCalledTimes(1);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.publicKey).toBe(PUBLIC_KEY);
    expect(result.current.walletError).toBeNull();
  });

  it('returns to disconnected with an error when the user rejects', async () => {
    getUserInfo.mockResolvedValue({});
    const { result } = renderWallet();

    let returned;
    await act(async () => {
      returned = await result.current.connectWallet();
    });

    expect(returned).toBeNull();
    expect(result.current.isDisconnected).toBe(true);
    expect(result.current.publicKey).toBeNull();
    expect(result.current.walletError).toMatch(/denied|cancelled/i);
  });

  it('surfaces a network mismatch instead of reporting a connection', async () => {
    getNetwork.mockResolvedValue('MAINNET');
    const { result } = renderWallet();

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(result.current.isNetworkMismatch).toBe(true);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.walletError).toMatch(/network mismatch/i);
  });

  it('times out a wallet request that never resolves', async () => {
    vi.useFakeTimers();
    setAllowed.mockImplementation(() => new Promise(() => {}));
    const { result } = renderWallet();

    act(() => {
      result.current.connectWallet();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(result.current.isDisconnected).toBe(true);
    expect(result.current.walletError).toMatch(/timed out/i);
  });

  it('disconnects and clears the public key', async () => {
    const { result } = renderWallet();

    await act(async () => {
      await result.current.connectWallet();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      result.current.disconnectWallet();
    });

    expect(result.current.isDisconnected).toBe(true);
    expect(result.current.publicKey).toBeNull();
  });

  it('reports a network change that happens while connected', async () => {
    const { result } = renderWallet();

    await act(async () => {
      await result.current.connectWallet();
    });

    act(() => {
      result.current.notifyNetworkChange('MAINNET');
    });

    expect(result.current.isNetworkMismatch).toBe(true);
    expect(result.current.walletError).toMatch(/network changed/i);
  });

  it('throws when the hook is used outside of the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useFreighterWallet())).toThrow(
      'useFreighterWallet must be used within a FreighterWalletProvider',
    );

    consoleError.mockRestore();
  });

  it('uses the offline mock wallet flow without touching Freighter', async () => {
    vi.stubEnv('VITE_MOCK_WALLET', 'true');
    const { result } = renderWallet();

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.publicKey).toBe(PUBLIC_KEY);
    expect(setAllowed).not.toHaveBeenCalled();
  });
});
