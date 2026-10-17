import { useEffect, useState } from 'react';
import {
  DEPLOYMENT_STATUS,
  resolveManifestUrl,
  verifyConfiguredContract,
} from '../utils/contractManifest';

/**
 * useContractManifest (Issue #792)
 *
 * Runs once at startup: fetch the signed canonical manifest of official
 * contract addresses, verify its signature against the pinned signers, and
 * report whether the configured `VITE_CONTRACT_ID` belongs to it.
 *
 * @param {object}  params
 * @param {string}  params.contractId  configured contract address
 * @param {string}  [params.network]   configured network passphrase
 * @param {boolean} [params.enabled]   skip the check entirely when false
 * @returns {{status: string, reason: string, contractId?: string, entry?: object, manifestUrl: string}}
 */
export default function useContractManifest({ contractId, network, enabled = true } = {}) {
  const [state, setState] = useState(() => ({
    status: DEPLOYMENT_STATUS.CHECKING,
    reason: '',
    contractId,
    manifestUrl: resolveManifestUrl(),
  }));

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    verifyConfiguredContract({ contractId, network })
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: DEPLOYMENT_STATUS.UNVERIFIED,
            reason: error && error.message ? error.message : 'Manifest verification failed.',
            contractId,
            manifestUrl: resolveManifestUrl(),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [contractId, network, enabled]);

  return state;
}
