import { useCallback, useEffect, useState } from 'react';
import { getNetwork } from '@stellar/freighter-api';
import {
  EXPECTED_PASSPHRASE,
  networksMatch,
  networkLabel,
} from '../utils/networkMismatch';

const DEFAULT_POLL_MS = 5000;

/**
 * Poll Freighter for the network it is currently pointed at and compare it with
 * the network this app is configured for (`VITE_NETWORK_PASSPHRASE`).
 *
 * Issue #714: a user whose Freighter is on a different network would otherwise
 * hit a confusing low-level transaction failure. This hook surfaces the
 * mismatch so the UI can warn them and block the buy action until they switch.
 *
 * @param {{ enabled?: boolean, pollMs?: number }} [options]
 * @returns {{ mismatch: boolean, walletNetwork: string|null, expected: string, checkNow: () => Promise<void> }}
 */
export default function useNetworkMismatch({ enabled = true, pollMs = DEFAULT_POLL_MS } = {}) {
  const [walletNetwork, setWalletNetwork] = useState(null);
  const [mismatch, setMismatch] = useState(false);

  const checkNow = useCallback(async () => {
    if (!enabled) {
      setMismatch(false);
      return;
    }
    try {
      const reported = await getNetwork();
      setWalletNetwork(reported ?? null);
      // `networksMatch` returns true for an unknown response, so a missing
      // Freighter extension never blocks the UI.
      setMismatch(!networksMatch(reported, EXPECTED_PASSPHRASE));
    } catch {
      // Freighter not installed / locked / permission denied — don't block.
      setWalletNetwork(null);
      setMismatch(false);
    }
  }, [enabled]);

  useEffect(() => {
    checkNow();
    const intervalId = setInterval(checkNow, pollMs);
    const onFocus = () => checkNow();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [checkNow, pollMs]);

  return {
    mismatch,
    walletNetwork,
    expected: networkLabel(EXPECTED_PASSPHRASE),
    checkNow,
  };
}
