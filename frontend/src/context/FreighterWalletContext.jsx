import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { isAllowed, setAllowed, getUserInfo, getNetwork } from '@stellar/freighter-api';
import {
  WalletState,
  WalletEvent,
  freighterWalletReducer,
  createInitialWalletState,
} from '../machines/freighterWalletMachine';

const FreighterWalletContext = createContext(null);

const WALLET_TIMEOUT_MS = 10000;

export function FreighterWalletProvider({ children, expectedNetwork = 'TESTNET' }) {
  const [machineState, dispatch] = useReducer(
    freighterWalletReducer,
    expectedNetwork,
    createInitialWalletState
  );

  const timeoutRef = useRef(null);

  // Clear pending timeout on unmount or transition
  const clearWalletTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Dispatch connection request with deterministic state machine & timeout handling
  const connectWallet = useCallback(async () => {
    dispatch({ type: WalletEvent.CONNECT });
    clearWalletTimeout();

    // Set asynchronous wallet connection timeout
    timeoutRef.current = setTimeout(() => {
      dispatch({ type: WalletEvent.TIMEOUT });
    }, WALLET_TIMEOUT_MS);

    try {
      if (import.meta.env.VITE_MOCK_WALLET === 'true') {
        await new Promise((resolve) => setTimeout(resolve, 300));
        clearWalletTimeout();

        const mockPublicKey = 'GBAZE64FKVPG4JUUP2BH63746JJ22G3A2S4QPF4UWKVA2RELLFLQZQVR';
        dispatch({
          type: WalletEvent.RESOLVE_ACCESS,
          payload: {
            publicKey: mockPublicKey,
            network: expectedNetwork,
          },
        });
        return mockPublicKey;
      }

      await setAllowed();
      const user = await getUserInfo();
      let currentNetwork = expectedNetwork;
      try {
        currentNetwork = await getNetwork();
      } catch (e) {
        // Fallback network
      }

      clearWalletTimeout();

      if (user?.publicKey) {
        dispatch({
          type: WalletEvent.RESOLVE_ACCESS,
          payload: {
            publicKey: user.publicKey,
            network: currentNetwork,
          },
        });
        return user.publicKey;
      } else {
        throw new Error('User denied or cancelled Freighter wallet connection');
      }
    } catch (err) {
      clearWalletTimeout();
      dispatch({
        type: WalletEvent.REJECT_ACCESS,
        payload: {
          error: err?.message || 'Wallet authorization rejected',
        },
      });
      return null;
    }
  }, [clearWalletTimeout, expectedNetwork]);

  const disconnectWallet = useCallback(() => {
    clearWalletTimeout();
    dispatch({ type: WalletEvent.DISCONNECT });
  }, [clearWalletTimeout]);

  const notifyNetworkChange = useCallback((newNetwork) => {
    dispatch({
      type: WalletEvent.NETWORK_CHANGE,
      payload: { network: newNetwork },
    });
  }, []);

  useEffect(() => {
    return () => clearWalletTimeout();
  }, [clearWalletTimeout]);

  // Derived Boolean getters mathematically bound to the single machine state string
  const isConnected = machineState.currentState === WalletState.CONNECTED;
  const isConnecting = machineState.currentState === WalletState.REQUESTING_ACCESS;
  const isNetworkMismatch = machineState.currentState === WalletState.NETWORK_MISMATCH;
  const isDisconnected = machineState.currentState === WalletState.DISCONNECTED;

  const value = {
    machineState: machineState.currentState,
    context: machineState.context,
    publicKey: machineState.context.publicKey,
    walletError: machineState.context.error,
    isConnected,
    isConnecting,
    isNetworkMismatch,
    isDisconnected,
    connectWallet,
    disconnectWallet,
    notifyNetworkChange,
    dispatch,
  };

  return (
    <FreighterWalletContext.Provider value={value}>
      {children}
    </FreighterWalletContext.Provider>
  );
}

export function useFreighterWallet() {
  const context = useContext(FreighterWalletContext);
  if (!context) {
    throw new Error('useFreighterWallet must be used within a FreighterWalletProvider');
  }
  return context;
}
