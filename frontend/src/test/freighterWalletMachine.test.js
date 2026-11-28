import { describe, it, expect } from 'vitest';
import {
  WalletState,
  WalletEvent,
  freighterWalletReducer,
  createInitialWalletState,
} from '../machines/freighterWalletMachine';

describe('Freighter Wallet State Machine (FSM)', () => {
  it('mathematically prevents impossible states (e.g. isConnected && isConnecting)', () => {
    const initialState = createInitialWalletState('TESTNET');
    expect(initialState.currentState).toBe(WalletState.DISCONNECTED);

    // Transition to RequestingAccess
    const connectingState = freighterWalletReducer(initialState, { type: WalletEvent.CONNECT });
    expect(connectingState.currentState).toBe(WalletState.REQUESTING_ACCESS);

    // Derived states
    const isConnected = connectingState.currentState === WalletState.CONNECTED;
    const isConnecting = connectingState.currentState === WalletState.REQUESTING_ACCESS;

    // Both cannot be true at the same time!
    expect(isConnected && isConnecting).toBe(false);
  });

  it('smoothly returns to Disconnected when user rejects connection', () => {
    const initialState = createInitialWalletState('TESTNET');
    const connectingState = freighterWalletReducer(initialState, { type: WalletEvent.CONNECT });

    const rejectedState = freighterWalletReducer(connectingState, {
      type: WalletEvent.REJECT_ACCESS,
      payload: { error: 'User declined request' },
    });

    expect(rejectedState.currentState).toBe(WalletState.DISCONNECTED);
    expect(rejectedState.context.error).toBe('User declined request');
    expect(rejectedState.context.publicKey).toBeNull();
  });

  it('emits strict transition to NetworkMismatch on network mismatch or change', () => {
    const initialState = createInitialWalletState('TESTNET');
    const connectingState = freighterWalletReducer(initialState, { type: WalletEvent.CONNECT });

    // Connected to MAINNET when expecting TESTNET
    const mismatchState = freighterWalletReducer(connectingState, {
      type: WalletEvent.RESOLVE_ACCESS,
      payload: {
        publicKey: 'GBAZE64FKVPG4JUUP2BH63746JJ22G3A2S4QPF4UWKVA2RELLFLQZQVR',
        network: 'MAINNET',
        expectedNetwork: 'TESTNET',
      },
    });

    expect(mismatchState.currentState).toBe(WalletState.NETWORK_MISMATCH);
    expect(mismatchState.context.error).toContain('Network mismatch');
  });

  it('handles asynchronous wallet timeout explicitly', () => {
    const initialState = createInitialWalletState('TESTNET');
    const connectingState = freighterWalletReducer(initialState, { type: WalletEvent.CONNECT });

    const timedOutState = freighterWalletReducer(connectingState, { type: WalletEvent.TIMEOUT });

    expect(timedOutState.currentState).toBe(WalletState.DISCONNECTED);
    expect(timedOutState.context.error).toContain('timed out');
  });
});
