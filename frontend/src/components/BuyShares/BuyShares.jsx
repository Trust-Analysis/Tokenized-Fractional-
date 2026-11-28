import React, { useState, useReducer, useId } from 'react';
import Card from '../Card/Card';
import Input from '../Input/Input';
import Button from '../Button/Button';
import Spinner from '../Spinner/Spinner';
import Skeleton from '../Skeleton/Skeleton';
import SocialShare from '../SocialShare/SocialShare';
import ConfirmPurchase from '../ConfirmPurchase/ConfirmPurchase';
import { formatPrice, GAS_TIERS, calculatePurchaseFees, validateSharePurchaseInput } from '../../utils/feeCalculator';
import {
  BuyFlowState,
  BuyFlowEvent,
  buyFlowReducer,
  createInitialBuyFlowState,
  isBuyFlowOpen,
} from '../../machines/buyFlowMachine';
import { useDebouncedCallback } from '../../hooks/useDebounce';
import styles from './BuyShares.module.css';

const STROOP = 10_000_000;
export { formatPrice, GAS_TIERS };

/**
 * Enhanced BuyShares Component (#278)
 *
 * Issue #718: all purchase business logic now comes from pure, unit-tested
 * modules — `buyFlowReducer` drives the modal lifecycle and
 * `calculatePurchaseFees` / `validateSharePurchaseInput` own the fee maths and
 * input validation — so the component itself only handles presentation.
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
  userWalletBalance = null, // in stroops or XLM
  recentTransactions = [],
  hasPendingTx = false,
  recoveringTx = false,
}) {
  const [localBuyAmount, setLocalBuyAmount] = useState(1);
  const [gasTier, setGasTier] = useState('standard');
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [buyFlow, dispatchBuyFlow] = useReducer(buyFlowReducer, undefined, createInitialBuyFlowState);

  // The machine's single `status` string decides whether the modal is mounted.
  const isConfirming = isBuyFlowOpen(buyFlow);

  const buyAmountInputId = useId();
  const paymentTokenSelectId = useId();

  const isControlled = controlledBuyAmount !== undefined && onBuyAmountChange !== undefined;
  const buyAmount = isControlled ? controlledBuyAmount : localBuyAmount;

  // Debounce the controlled callback to prevent rapid successive calls (e.g., RPC calls)
  // when typing in the buy amount input field
  const debouncedOnBuyAmountChange = useDebouncedCallback(
    (val) => {
      if (isControlled && onBuyAmountChange) {
        onBuyAmountChange(val);
      }
    },
    400 // 400ms debounce delay
  );

  const setBuyAmount = (val) => {
    const parsed = Math.max(1, Math.floor(Number(val) || 1));
    if (isControlled) {
      debouncedOnBuyAmountChange(parsed);
    } else {
      setLocalBuyAmount(parsed);
    }
  };

  const soldShares = totalShares != null && availableShares != null ? totalShares - availableShares : null;
  const pct = totalShares != null && totalShares > 0 && availableShares != null
    ? Math.round(((totalShares - availableShares) / totalShares) * 100)
    : null;

  // Real-time calculations — reuse the pure helper covered by unit tests
  // instead of duplicating the fee maths inline.
  const {
    baseCostStroops,
    platformFeeStroops,
    networkFeeStroops,
    totalCostStroops,
    estimatedTime,
  } = calculatePurchaseFees({
    buyAmount,
    pricePerShareStroops: pricePerShare,
    gasTier,
  });

  // Input Validation — pure and unit-tested (src/test/SharePurchaseModal.test.js).
  const validationError = validateSharePurchaseInput({
    buyAmount,
    availableShares,
    userWalletBalanceStroops: userWalletBalance,
    totalCostStroops,
  });

  const handleOpenConfirm = () => {
    if (validationError) return;
    dispatchBuyFlow({ type: BuyFlowEvent.REVIEW });
  };

  const handleConfirmPurchase = async () => {
    dispatchBuyFlow({ type: BuyFlowEvent.CONFIRM });
    try {
      let hash;
      if (onBuy) {
        const result = await onBuy({
          amount: buyAmount,
          gasTier,
          totalCostStroops,
          platformFeeStroops,
          networkFeeStroops,
          paymentToken,
        });
        hash = result?.txHash || `0x${Math.random().toString(16).substring(2, 42)}`;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        hash = `0x${Math.random().toString(16).substring(2, 42)}`;
      }
      dispatchBuyFlow({ type: BuyFlowEvent.SUCCEEDED, payload: { txHash: hash } });
    } catch (err) {
      dispatchBuyFlow({
        type: BuyFlowEvent.FAILED,
        payload: { error: err.message || 'Transaction failed or rejected by network.' },
      });
    }
  };

  const shortAddress = (addr) =>
    addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';

  return (
    <Card className={styles.buyCard}>
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

      {/* ── Real-Time Price & Fee Calculations (#278) ──────────────── */}
      {pricePerShare != null && (
        <div className={styles.priceSection}>
          <div className={styles.priceRow}>
            <span className={styles.priceLabel}>Price per share</span>
            <span className={styles.priceValue}>{formatPrice(pricePerShare)} XLM</span>
          </div>

          <div className={styles.priceRow}>
            <span className={styles.priceLabel}>
              Base Shares Cost ({buyAmount} share{buyAmount !== 1 ? 's' : ''})
            </span>
            <span className={styles.priceValue}>{formatPrice(baseCostStroops)} XLM</span>
          </div>

          <div className={styles.priceRow}>
            <span className={styles.priceLabel}>
              Platform Fee (0.5%)
              <button
                type="button"
                className={styles.infoTooltipBtn}
                onClick={() => setActiveTooltip(activeTooltip === 'platform' ? null : 'platform')}
                title="Platform fee info"
              >
                ⓘ
              </button>
            </span>
            <span className={styles.priceValue}>{formatPrice(platformFeeStroops)} XLM</span>
          </div>
          {activeTooltip === 'platform' && (
            <div className={styles.tooltipBox}>
              Platform Fee: A low 0.5% fee supporting marketplace smart contracts and operations.
            </div>
          )}

          <div className={styles.priceRow}>
            <span className={styles.priceLabel}>
              Network / Gas Fee
              <button
                type="button"
                className={styles.infoTooltipBtn}
                onClick={() => setActiveTooltip(activeTooltip === 'gas' ? null : 'gas')}
                title="Gas fee info"
              >
                ⓘ
              </button>
            </span>
            <span className={styles.priceValue}>{formatPrice(networkFeeStroops)} XLM</span>
          </div>
          {activeTooltip === 'gas' && (
            <div className={styles.tooltipBox}>
              Network Fee: Paid to Stellar network validators to include your transaction.
            </div>
          )}

          <hr className={styles.dividerSub} />

          <div className={styles.priceRow}>
            <span className={styles.priceLabelBold}>Total Estimated Cost</span>
            <span className={styles.totalCostValue}>{formatPrice(totalCostStroops)} XLM</span>
          </div>

          <div className={styles.timelineHint}>
            ⏱ Estimated Timeline: <strong>{estimatedTime}</strong> confirmation
          </div>
        </div>
      )}

      {/* ── Gas Tier Selector (#278) ─────────────────────────────────── */}
      <div className={styles.gasSelectorRow}>
        <label htmlFor="gas-tier-select" className={styles.gasLabel}>Gas Estimation Speed:</label>
        <select
          id="gas-tier-select"
          className={styles.gasSelect}
          value={gasTier}
          onChange={(e) => setGasTier(e.target.value)}
          disabled={loadingBuy}
        >
          {Object.entries(GAS_TIERS).map(([key, info]) => (
            <option key={key} value={key}>
              {info.name} ({formatPrice(info.feeStroops)} XLM)
            </option>
          ))}
        </select>
      </div>

      <hr className={styles.divider} />

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

      {/* ── Pending Transaction Recovery Alert (Issue #719) ─────────────────── */}
      {hasPendingTx && (
        <div className={styles.pendingTxAlert}>
          {recoveringTx ? (
            <>
              <Spinner size="sm" label="Checking transaction status…" />
              <span>Checking the status of your pending transaction…</span>
            </>
          ) : (
            <>
              <span>You have a pending transaction from your previous session. </span>
              <span style={{ fontWeight: 'bold' }}>Please wait for it to complete before starting a new purchase.</span>
            </>
          )}
        </div>
      )}

      <h3 className={styles.purchaseHeader}>Buy Fractional Shares</h3>

      {acceptedTokens.length > 1 && (
        <div className={styles.tokenRow}>
          <label htmlFor={paymentTokenSelectId} className={styles.tokenLabel}>
            Pay with
          </label>
          <select
            id={paymentTokenSelectId}
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
          id={buyAmountInputId}
          type="number"
          value={buyAmount}
          onChange={(e) => setBuyAmount(e.target.value)}
          min="1"
          max={availableShares ?? undefined}
          disabled={loadingBuy || hasPendingTx}
          className={styles.buyInput}
        />
        <Button
          onClick={handleOpenConfirm}
          loading={loadingBuy}
          disabled={!!validationError || loadingBuy || hasPendingTx}
          variant="primary"
        >
          {loadingBuy ? 'Processing…' : hasPendingTx ? 'Pending Transaction' : 'Review Purchase'}
        </Button>
      </div>

      {validationError && (
        <div className={styles.validationErrorMsg} role="alert">
          ⚠️ {validationError}
        </div>
      )}

      {/* ── Recent Asset Transactions Context (#278) ────────────────── */}
      {recentTransactions.length > 0 && (
        <div className={styles.recentTxSection}>
          <h4 className={styles.recentTxTitle}>Recent Activity for Asset</h4>
          <ul className={styles.recentTxList}>
            {recentTransactions.slice(0, 3).map((tx, idx) => (
              <li key={tx.id || idx} className={styles.recentTxItem}>
                <span>Bought {tx.shareCount} share{tx.shareCount > 1 ? 's' : ''}</span>
                <span className={styles.recentTxDate}>{new Date(tx.timestamp || Date.now()).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Confirmation Modal Component (#278) ───────────────────────── */}
      {isConfirming && (
        <ConfirmPurchase
          asset={asset}
          shares={buyAmount}
          pricePerShare={pricePerShare}
          baseCostStroops={baseCostStroops}
          platformFeeStroops={platformFeeStroops}
          networkFeeStroops={networkFeeStroops}
          totalCostStroops={totalCostStroops}
          gasTier={gasTier}
          status={buyFlow.status === BuyFlowState.CONFIRMING ? null : buyFlow.status}
          txHash={buyFlow.txHash}
          errorMessage={buyFlow.error}
          onConfirm={handleConfirmPurchase}
          onCancel={() => dispatchBuyFlow({ type: BuyFlowEvent.CANCEL })}
        />
      )}

      {/* ── Social Share Section ──────────────────────────────────────── */}
      {asset && Object.keys(asset).length > 0 && (
        <>
          <hr className={styles.divider} />
          <div className={styles.socialShareSection}>
            <SocialShare
              asset={asset}
              url={shareUrl || (typeof window !== 'undefined' ? window.location.href : '')}
              compact={false}
              showLabel={true}
            />
          </div>
        </>
      )}
    </Card>
  );
}
