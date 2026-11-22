import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Issue #718 — wallet + Soroban RPC boundary for `useSorobanWrite`.
 *
 * Both external boundaries are mocked: the Stellar SDK (RPC server / tx
 * builder) and Freighter (`signTransaction`). No network call is ever made.
 */

const hoisted = vi.hoisted(() => ({
  // A 56-character contract id so `useSoroban.js#getContract()` returns a
  // Contract instance instead of the `null` guard.
  CONTRACT_ID: `C${'A'.repeat(55)}`,
  WALLET_PUBLIC_KEY: 'GTESTWALLETADDRESS',
  // Captures the module-level `new rpc.Server(...)` instance under test.
  servers: [],
  signTransaction: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', () => {
  const makeBuilder = () => {
    const builder = {
      addOperation: vi.fn(() => builder),
      setTimeout: vi.fn(() => builder),
      build: vi.fn(() => ({ toXDR: () => 'UNSIGNED_XDR' })),
    };
    return builder;
  };

  class TransactionBuilder {
    constructor() {
      return makeBuilder();
    }
  }
  TransactionBuilder.fromXDR = vi.fn((xdr) => ({ signedXdr: xdr }));

  class Contract {
    constructor(id) {
      this.id = id;
    }

    call(...args) {
      return { op: args };
    }
  }

  class Server {
    constructor(url) {
      this.url = url;
      this.getAccount = vi.fn(async () => ({ accountId: hoisted.WALLET_PUBLIC_KEY }));
      this.simulateTransaction = vi.fn(async () => ({ result: { retval: 1 } }));
      this.sendTransaction = vi.fn(async () => ({ hash: 'tx-hash-123', status: 'PENDING' }));
      hoisted.servers.push(this);
    }
  }

  return {
    rpc: {
      Server,
      assembleTransaction: vi.fn(() => ({ build: () => ({ toXDR: () => 'SIGNED_XDR' }) })),
    },
    TransactionBuilder,
    Networks: { TESTNET: 'Test SDF Network ; September 2015' },
    Contract,
  };
});

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: hoisted.signTransaction,
}));

vi.mock('../store/useWalletStore', () => {
  const state = { publicKey: hoisted.WALLET_PUBLIC_KEY, setShares: vi.fn() };
  const useWalletStore = () => state;
  useWalletStore.getState = () => state;
  return { useWalletStore };
});

let useSorobanWrite;

beforeAll(async () => {
  // Read at module load time, so it must be set before the dynamic import.
  vi.stubEnv('VITE_CONTRACT_ID', hoisted.CONTRACT_ID);
  vi.stubEnv('VITE_MOCK_WALLET', 'false');
  ({ useSorobanWrite } = await import('../hooks/useSoroban.js'));
});

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.signTransaction.mockResolvedValue({ signedTxXdr: 'SIGNED_XDR', error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('useSorobanWrite — Soroban RPC / Freighter boundary (#718)', () => {
  it('simulates, signs through Freighter and submits a Soroban transaction', async () => {
    const server = hoisted.servers[0];
    const { result } = renderHook(() => useSorobanWrite('buy_shares'));

    let response;
    await act(async () => {
      response = await result.current.execute([1, 5], { fee: '10000' });
    });

    expect(response).toEqual({ hash: 'tx-hash-123', status: 'PENDING' });
    expect(server.getAccount).toHaveBeenCalledWith(hoisted.WALLET_PUBLIC_KEY);
    expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(hoisted.signTransaction).toHaveBeenCalledTimes(1);
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('maps a rejected signature to an error without submitting', async () => {
    const server = hoisted.servers[0];
    hoisted.signTransaction.mockResolvedValue({
      signedTxXdr: null,
      error: new Error('User rejected the request'),
    });

    const { result } = renderHook(() => useSorobanWrite('buy_shares'));

    await act(async () => {
      await expect(result.current.execute([1, 5])).rejects.toThrow('User rejected the request');
    });

    expect(server.sendTransaction).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
    expect(result.current.loading).toBe(false);
  });

  it('keeps the buy_shares write path offline in mock-wallet mode', async () => {
    vi.stubEnv('VITE_MOCK_WALLET', 'true');
    const { result } = renderHook(() => useSorobanWrite('buy_shares'));

    let response;
    await act(async () => {
      response = await result.current.execute([1, { u32: () => 5 }]);
    });

    expect(response.hash).toMatch(/^mock_tx_hash_/);
    expect(hoisted.signTransaction).not.toHaveBeenCalled();
  });
});
