import React from 'react';
import Modal from '../Modal/Modal';
import Button from '../Button/Button';
import styles from './ConfirmPurchase.module.css';

// Contract price is stored in stroops (1 stroop = 10^-7 XLM)
function formatPrice(stroops) {
  if (stroops == null) return '—';
  return (Number(stroops) / 1e7).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  }) + ' XLM';
}

export default function ConfirmPurchase({ shares, pricePerShare, onConfirm, onCancel, loading }) {
  const total = pricePerShare != null ? Number(pricePerShare) * shares : null;

  return (
    <Modal
      title="Confirm Purchase"
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={loading}>
            {loading ? 'Processing…' : 'Confirm'}
          </Button>
        </>
      }
    >
      <table className={styles.table}>
        <tbody>
          <tr>
            <th>Shares</th>
            <td>{shares}</td>
          </tr>
          <tr>
            <th>Price per share</th>
            <td>{formatPrice(pricePerShare)}</td>
          </tr>
          <tr className={styles.total}>
            <th>Total cost</th>
            <td>{formatPrice(total)}</td>
          </tr>
        </tbody>
      </table>
    </Modal>
  );
}
