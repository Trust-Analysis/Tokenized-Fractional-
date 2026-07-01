import React, { useState } from 'react';
import Card from '../Card/Card';
import Input from '../Input/Input';
import Button from '../Button/Button';
import Spinner from '../Spinner/Spinner';
import Skeleton from '../Skeleton/Skeleton';
import SocialShare from '../SocialShare/SocialShare';
import styles from './BuyShares.module.css';

const STROOP = 10_000_000; // 1 XLM = 10,000,000 stroops

function formatPrice(stroops) {
  return (stroops / STROOP).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
}

/**
 * BuyShares — displays share balance, availability, price, and a buy form.
 *
 * @param {number}   shares           - Current share balance
 * @param {boolean}  loadingShares    - Fetching share balance
 * @param {boolean}  loadingBuy       - Transaction in progress
 * @param {function} onBuy            - Called with (amount) when user clicks Buy
 * @param {string[]} acceptedTokens   - List of accepted payment token addresses
 * @param {string}   paymentToken     - Currently selected payment token address
 * @param {function} onTokenChange    - Called with token address when selection changes
 * @param {number|null} availableShares - Shares still available to purchase
 * @param {number|null} totalShares   - Total shares issued
 * @param {number|null} pricePerShare - Price per share in stroops
 * @param {number}   buyAmount        - Controlled buy amount (optional)
 * @param {function} onBuyAmountChange - Controlled setter for buy amount (optional)
 * @param {Object}   asset            - Asset object with title, location, assetType, contractId
 * @param {string}   shareUrl         - Custom share URL (optional)
 */
export default function BuyShares({
  shares = 0,
  loadingShares = false,
  loadingBuy = false,
  onBuy,
  acceptedTokens = [],
  paymentToken = '',
  onTokenChange,
  availableShares = null,
  totalShares = null,
  pricePerShare = null,
  buyAmount: controlledBuyAmount,
  onBuyAmountChange,
  asset = {},
  shareUrl = '',
}) {
  const [localBuyAmount, setLocalBuyAmount] = useState(1);
  const isControlled = controlledBuyAmount !== undefined && onBuyAmountChange !== undefined;
  const buyAmount = isControlled ? controlledBuyAmount : localBuyAmount;
  const setBuyAmount = isControlled
    ? (v) => onBuyAmountChange(Math.max(1, v))
    : (v) => setLocalBuyAmount(Math.max(1, v));

  const soldShares = totalShares != null && availableShares != null ? totalShares - availableShares : null;
  const pct = totalShares != null && totalShares > 0 && availableShares != null
    ? Math.round(((totalShares - availableShares) / totalShares) * 100)
    : null;

  const totalCost = pricePerShare != null ? pricePerShare * buyAmount : null;

  const shortAddress = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '');

  return (
    <Card>
      {/* ── Availability section ─────────────────────────────────────── */}
      {(availableShares != null || totalShares != null) && (
        <div className={styles.availabilitySection}>
          <div className={styles.availabilityHeader}>
            <span className={styles.availabilityLabel}>Share Availability</span>
            {availableShares != null && totalShares != null ? (
              <span className={styles.availabilityCount}>
                <strong>{availableShares.toLocaleString()}</strong>
                <span className={styles.availabilityTotal}> / {totalShares.toLocaleString()} available</span>
              </span>
            ) : (
              <Skeleton variant="text" width="6rem" height="1em" />
            )}
          </div>
          {pct != null ? (
            <div className={styles.progressTrack} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% of shares sold`}>
              <div className={styles.progressFill} style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <Skeleton variant="text" height="0.6rem" style={{ borderRadius: '99px' }} />
          )}
          {soldShares != null && totalShares != null && (
            <span className={styles.progressCaption}>{pct}% sold ({soldShares.toLocaleString()} of {totalShares.toLocaleString()})</span>
          )}
        </div>
      )}

      {/* ── Price section ─────────────────────────────────────────────── */}
      {pricePerShare != null && (
        <div className={styles.priceSection}>
          <div className={styles.priceRow}>
            <span className={styles.priceLabel}>Price per share</span>
            <span className={styles.priceValue}>{formatPrice(pricePerShare)} XLM</span>
          </div>
          {totalCost != null && (
            <div className={styles.priceRow}>
              <span className={styles.priceLabel}>
                Total cost
                <span className={styles.priceLabelSub}> ({buyAmount} share{buyAmount !== 1 ? 's' : ''})</span>
              </span>
              <span className={styles.totalCostValue}>{formatPrice(totalCost)} XLM</span>
            </div>
          )}
        </div>
      )}

      {(availableShares != null || pricePerShare != null) && <hr className={styles.divider} />}

      {/* ── Holdings row ──────────────────────────────────────────────── */}
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

      {acceptedTokens.length > 1 && (
        <div className={styles.tokenRow}>
          <label htmlFor="payment-token-select" className={styles.tokenLabel}>
            Pay with
          </label>
          <select
            id="payment-token-select"
            className={styles.tokenSelect}
            value={paymentToken}
            onChange={(e) => onTokenChange && onTokenChange(e.target.value)}
            disabled={loadingBuy}
          >
            {acceptedTokens.map((t) => (
              <option key={t} value={t} title={t}>
                {shortAddress(t)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.purchaseRow}>
        <Input
          id="buy-amount-input"
          type="number"
          value={buyAmount}
          onChange={(e) => setBuyAmount(Number(e.target.value))}
          min="1"
          max={availableShares ?? undefined}
          disabled={loadingBuy}
          className={styles.buyInput}
        />
        <Button onClick={() => onBuy && onBuy(buyAmount)} loading={loadingBuy} variant="primary">
          {loadingBuy ? 'Processing…' : 'Buy Shares'}
        </Button>
      </div>

      {loadingBuy && (
        <div className={styles.buyLoadingHint}>
          <Spinner size="sm" label="Processing transaction…" />
          <span>Submitting transaction to the network…</span>
        </div>
      )}

      {/* ── Social Share Section ──────────────────────────────────────── */}
      {asset && Object.keys(asset).length > 0 && (
        <>
          <hr className={styles.divider} />
          <div className={styles.socialShareSection}>
            <SocialShare
              asset={asset}
              url={shareUrl || window.location.href}
              compact={false}
              showLabel={true}
              onShare={(platform) => {
                console.log(`Shared on ${platform}`);
              }}
            />
          </div>
        </>
      )}
    </Card>
  );
}
