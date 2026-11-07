const STROOP = 10_000_000;

export function formatPrice(stroops) {
  if (stroops == null) return '0.00';
  return (stroops / STROOP).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });
}

export const GAS_TIERS = {
  low: { name: 'Low Speed', feeStroops: 100, estimatedTime: '~8 sec' },
  standard: { name: 'Standard (Recommended)', feeStroops: 1000, estimatedTime: '~5 sec' },
  priority: { name: 'Priority Speed', feeStroops: 5000, estimatedTime: '~2 sec' },
};

export function calculatePurchaseFees({ buyAmount, pricePerShareStroops, gasTier = 'standard', platformFeeRate = 0.005 }) {
  const baseCostStroops = (pricePerShareStroops || 0) * (buyAmount || 0);
  const platformFeeStroops = Math.round(baseCostStroops * platformFeeRate);
  const networkFeeStroops = GAS_TIERS[gasTier]?.feeStroops || 1000;
  const totalCostStroops = baseCostStroops + platformFeeStroops + networkFeeStroops;

  return {
    baseCostStroops,
    platformFeeStroops,
    networkFeeStroops,
    totalCostStroops,
    estimatedTime: GAS_TIERS[gasTier]?.estimatedTime || '~5 sec',
  };
}

export function validateSharePurchaseInput({ buyAmount, availableShares, userWalletBalanceStroops, totalCostStroops }) {
  if (!Number.isInteger(Number(buyAmount)) || Number(buyAmount) <= 0) {
    return 'Please enter a valid positive whole number of shares.';
  }
  if (availableShares != null && buyAmount > availableShares) {
    return `Quantity exceeds available shares (${availableShares.toLocaleString()}).`;
  }
  if (userWalletBalanceStroops != null && totalCostStroops > userWalletBalanceStroops) {
    return `Total cost (${formatPrice(totalCostStroops)} XLM) exceeds wallet balance (${formatPrice(userWalletBalanceStroops)} XLM).`;
  }
  return null;
}
