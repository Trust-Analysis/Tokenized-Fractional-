import { useCallback, useEffect, useState } from 'react';
import { readString, writeString, removeItem, STORAGE_KEYS } from '../lib/storage';

const FALLBACK_ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFIM33A';

/**
 * Auto-reconnect a previously approved Freighter session (Issue #785).
 *
 * This is separate from `useWalletStore`: it powers the lightweight wallet bar
 * and the NFT certificate gallery, which read the extension directly instead of
 * going through the signed-connection flow.
 */
export function useFreighterWallet() {
  const [walletAddress, setWalletAddress] = useState('');
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    const autoReconnect = async () => {
      const previouslyConnected = readString(STORAGE_KEYS.PREVIOUSLY_CONNECTED);
      if (previouslyConnected !== 'true') return;

      setIsReconnecting(true);
      try {
        if (window.freighterApi && typeof window.freighterApi.isConnected === 'function') {
          const isConnected = await window.freighterApi.isConnected();
          if (isConnected) {
            const publicKey = await window.freighterApi.getPublicKey();
            if (publicKey) {
              setWalletAddress(publicKey);
              writeString(STORAGE_KEYS.PREVIOUSLY_CONNECTED, 'true');
            }
          }
        }
      } catch (err) {
        console.warn('Silent wallet reconnection failed, falling back to manual connect:', err);
        removeItem(STORAGE_KEYS.PREVIOUSLY_CONNECTED);
      } finally {
        setIsReconnecting(false);
      }
    };

    autoReconnect();
  }, []);

  const connectWallet = useCallback(async () => {
    try {
      const publicKey = window.freighterApi
        ? await window.freighterApi.getPublicKey()
        : FALLBACK_ADDRESS;

      if (publicKey) {
        setWalletAddress(publicKey);
        writeString(STORAGE_KEYS.PREVIOUSLY_CONNECTED, 'true');
      }
    } catch (err) {
      console.error('Manual wallet connection error:', err);
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    setWalletAddress('');
    removeItem(STORAGE_KEYS.PREVIOUSLY_CONNECTED);
  }, []);

  return { walletAddress, isReconnecting, connectWallet, disconnectWallet };
}

export default useFreighterWallet;
