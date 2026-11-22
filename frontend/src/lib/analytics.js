/**
 * Analytics tracking for token transactions.
 * No PII is included in any analytics payloads.
 */

const ANALYTICS_ENDPOINT = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT || '/api/analytics';

function generateAnonymousId() {
  return 'anon_' + Math.random().toString(36).substring(2, 15);
}

let anonymousId = null;

function getAnonymousId() {
  if (!anonymousId) {
    anonymousId = localStorage.getItem('analytics_anon_id');
    if (!anonymousId) {
      anonymousId = generateAnonymousId();
      localStorage.setItem('analytics_anon_id', anonymousId);
    }
  }
  return anonymousId;
}

export function trackPurchaseInitiated(contractId, tokenAmount, currency) {
  const event = {
    event: 'purchase_initiated',
    anonymous_id: getAnonymousId(),
    contract_id: contractId,
    token_amount: tokenAmount,
    currency: currency,
    timestamp: Date.now(),
  };
  sendEvent(event);
}

export function trackPurchaseConfirmed(contractId, tokenAmount, currency, transactionHash) {
  const event = {
    event: 'purchase_confirmed',
    anonymous_id: getAnonymousId(),
    contract_id: contractId,
    token_amount: tokenAmount,
    currency: currency,
    transaction_hash: transactionHash ? hashTx(transactionHash) : undefined,
    timestamp: Date.now(),
  };
  sendEvent(event);
}

function hashTx(hash) {
  return hash.substring(0, 8) + '...' + hash.substring(hash.length - 4);
}

async function sendEvent(event) {
  try {
    await fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch (err) {
    // Silently fail - analytics should not break the app
  }
}
