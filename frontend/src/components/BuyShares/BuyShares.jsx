import React, { useState } from 'react';
import Card from '../Card/Card';
import Input from '../Input/Input';
import Button from '../Button/Button';
import Spinner from '../Spinner/Spinner';
import Skeleton from '../Skeleton/Skeleton';
import styles from './BuyShares.module.css';

/**
 * BuyShares — displays share balance and a form to purchase fractional shares.
 *
 * @param {number}  shares       - Current share balance
 * @param {boolean} loadingShares - Fetching share balance
 * @param {boolean} loadingBuy   - Transaction in progress
 * @param {function} onBuy        - Called with (amount) when user clicks Buy
 */
export default function BuyShares({
  shares = 0,
  loadingShares = false,
  loadingBuy = false,
  onBuy,
}) {
  const [buyAmount, setBuyAmount] = useState(1);

  const handleBuy = () => {
    if (onBuy) onBuy(buyAmount);
  };

  return (
    <Card>
      <div className={styles.holdingsRow}>
        <span className={styles.holdingsLabel}>Your Share Balance</span>
        {loadingShares ? (
          <span className={styles.holdingsValueLoading}>
            <Spinner size="sm" label="Fetching share balance…" />
            <Skeleton variant="text" width="3rem" height="1.6em" />
          </span>
        ) : (
          <span className={styles.holdingsValue}>{shares}</span>
        )}
      </div>
      <hr className={styles.divider} />
      <h3 className={styles.purchaseHeader}>Buy Fractional Shares</h3>
      <div className={styles.purchaseRow}>
        <Input
          id="buy-amount-input"
          type="number"
          value={buyAmount}
          onChange={(e) => setBuyAmount(Math.max(1, Number(e.target.value)))}
          min="1"
          disabled={loadingBuy}
          className={styles.buyInput}
        />
        <Button onClick={handleBuy} loading={loadingBuy} variant="primary">
          {loadingBuy ? 'Processing…' : 'Buy Shares'}
        </Button>
      </div>
      {loadingBuy && (
        <div className={styles.buyLoadingHint}>
          <Spinner size="sm" label="Processing transaction…" />
          <span>Submitting transaction to the network…</span>
        </div>
      )}
    </Card>
  );
}
