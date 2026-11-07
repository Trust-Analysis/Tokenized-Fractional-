import React from 'react';
import { DEPLOYMENT_STATUS } from '../../utils/contractManifest';
import styles from './ContractVerificationBanner.module.css';

/**
 * ContractVerificationBanner (Issue #792)
 *
 * A prominent, dismiss-resistant warning shown when the build-time
 * `VITE_CONTRACT_ID` is missing from the signed canonical manifest, or when
 * that manifest could not be verified at all.
 *
 * @param {object} props
 * @param {string} props.status               one of DEPLOYMENT_STATUS
 * @param {string} [props.reason]             human-readable explanation
 * @param {string} [props.configuredContractId]
 * @param {string} [props.manifestUrl]        link to the canonical manifest
 */
export default function ContractVerificationBanner({
  status,
  reason,
  configuredContractId,
  manifestUrl,
}) {
  const isUnofficial = status === DEPLOYMENT_STATUS.UNOFFICIAL;
  const isUnverified = status === DEPLOYMENT_STATUS.UNVERIFIED;

  if (!isUnofficial && !isUnverified) return null;

  const heading = isUnofficial
    ? 'This build points at a contract that is not officially recognised.'
    : 'Could not verify the official contract manifest.';

  return (
    <div
      role="alert"
      data-testid="contract-verification-banner"
      className={`${styles.banner} ${isUnofficial ? styles.danger : styles.warning}`}
    >
      <span className={styles.icon} aria-hidden="true">
        ⚠
      </span>
      <div className={styles.body}>
        <strong className={styles.heading}>{heading}</strong>
        <p className={styles.reason}>
          {reason ||
            'The configured contract address could not be checked against the canonical list of official deployments.'}
        </p>
        {configuredContractId && (
          <p className={styles.meta}>
            Configured contract: <code className={styles.code}>{configuredContractId}</code>
          </p>
        )}
        <p className={styles.meta}>
          Do not enter your wallet details or sign transactions until this is resolved.{' '}
          {manifestUrl && (
            <a className={styles.link} href={manifestUrl} target="_blank" rel="noreferrer noopener">
              View the canonical manifest
            </a>
          )}
        </p>
      </div>
    </div>
  );
}
