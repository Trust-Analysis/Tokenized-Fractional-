import React from 'react';
import Modal from '../Modal/Modal';
import Button from '../Button/Button';
import Spinner from '../Spinner/Spinner';
import styles from './ConfirmPurchase.module.css';

function formatPrice(stroops) {
  if (stroops == null) return '0.00 XLM';
  return `${(Number(stroops) / 1e7).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  })} XLM`;
}

/**
 * Enhanced Multi-Step ConfirmPurchase Modal (#278)
 * 
 * This modal provides a clear confirmation step before wallet signing,
 * showing asset name, share amount, price per share, and total cost.
 */
export default function ConfirmPurchase({
  asset = {},
  shares = 1,
  pricePerShare = 0,
  baseCostStroops = 0,
  platformFeeStroops = 0,
  networkFeeStroops = 0,
  totalCostStroops = 0,
  gasTier = 'standard',
  status = null, // null | 'processing' | 'success' | 'error'
  txHash = null,
  errorMessage = null,
  onConfirm,
  onCancel,
}) {
  const isProcessing = status === 'processing';
  const isSuccess = status === 'success';
  const isError = status === 'error';

  return (
    <Modal
      title={
        isSuccess
          ? 'Transaction Successful! 🎉'
          : isError
          ? 'Transaction Failed ⚠️'
          : 'Confirm Share Purchase'
      }
      onClose={onCancel}
      actions={
        <>
          {!isProcessing && !isSuccess && (
            <>
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
              <Button variant="primary" onClick={onConfirm}>
                Confirm & Sign Transaction
              </Button>
            </>
          )}

          {isProcessing && (
            <Button variant="primary" disabled loading>
              Processing on Network…
            </Button>
          )}

          {isSuccess && (
            <>
              <Button variant="secondary" onClick={onCancel}>
                Close
              </Button>

              <Button
                variant="primary"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.href = '/portfolio';
                  } else {
                    onCancel();
                  }
                }}
              >
                View Portfolio
              </Button>
            </>
          )}

          {isError && (
            <>
              <Button variant="secondary" onClick={onCancel}>
                Close
              </Button>
              <Button variant="primary" onClick={onConfirm}>
                Retry Transaction
              </Button>
            </>
          )}
        </>
      }
    >
      {/* ── Processing Loading State ── */}
      {isProcessing && (
        <div className={styles.statusBox}>
          <Spinner size="md" label="Broadcasting transaction to Stellar network..." />
          <p className={styles.statusText}>
            Submitting order for <strong>{shares} share{shares > 1 ? 's' : ''}</strong> of {asset.title || 'RWA Asset'}...
          </p>
          <div className={styles.timelineProgress}>
            <span>1. Estimated Gas</span> ➔ <span>2. Wallet Sign</span> ➔ <strong className={styles.activeStep}>3. Network Ledger</strong>
          </div>
        </div>
      )}

      {/* ── Success Feedback State ── */}
      {isSuccess && (
        <div className={styles.successBox}>
          <div className={styles.successIcon}>✓</div>
          <h3>Share Purchase Completed!</h3>
          <p>
            You successfully purchased <strong>{shares} share{shares > 1 ? 's' : ''}</strong> for <strong>{formatPrice(totalCostStroops)}</strong>.
          </p>
          {txHash && (
            <div className={styles.txHashRow}>
              <span>Transaction Hash:</span>
              <a
                href={`https://stellar.expert/explorer/public/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className={styles.txHashLink}
              >
                {txHash.slice(0, 10)}...{txHash.slice(-8)} ↗
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── Error Feedback State ── */}
      {isError && (
        <div className={styles.errorBox}>
          <h3>Transaction Failed</h3>
          <p>{errorMessage || 'An error occurred while communicating with the blockchain network.'}</p>
        </div>
      )}

      {/* ── Transaction Preview Table (Before Confirm) ── */}
      {!isProcessing && !isSuccess && (
        <div className={styles.modalContent}>
          <div className={styles.assetHeader}>
            <strong>{asset.title || 'Tokenized Asset'}</strong>
            <span className={styles.assetContractId}>{asset.contractId}</span>
          </div>

          <table className={styles.table}>
            <tbody>
              <tr>
                <th>Asset Name</th>
                <td>{asset.title || 'Tokenized Asset'}</td>
              </tr>
              <tr>
                <th>Shares Being Purchased</th>
                <td>{shares}</td>
              </tr>
              <tr>
                <th>Price Per Share</th>
                <td>{formatPrice(pricePerShare)}</td>
              </tr>
              <tr>
                <th>Base Cost</th>
                <td>{formatPrice(baseCostStroops)}</td>
              </tr>
              <tr>
                <th>Platform Fee (0.5%)</th>
                <td>{formatPrice(platformFeeStroops)}</td>
              </tr>
              <tr>
                <th>Network / Gas Fee ({gasTier})</th>
                <td>{formatPrice(networkFeeStroops)}</td>
              </tr>
              <tr className={styles.totalRow}>
                <th>Total Cost</th>
                <td className={styles.totalAmount}>{formatPrice(totalCostStroops)}</td>
              </tr>
            </tbody>
          </table>

          <div className={styles.disclaimerBox}>
            ⚠️ <strong>Wallet Signing Required:</strong> After clicking "Confirm", your wallet (Freighter) will prompt you to sign this transaction. Please review the details above carefully before proceeding.
          </div>
        </div>
      )}
    </Modal>
  );
}
