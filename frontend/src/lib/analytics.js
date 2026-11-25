/**
 * Analytics tracking for token transactions.
 * No PII is included in any analytics payloads.
 */

import { readString, writeString, removeItem, STORAGE_KEYS } from './storage';

const ANALYTICS_ENDPOINT = import.meta.env?.VITE_ANALYTICS_ENDPOINT || '/api/analytics';

function generateAnonymousId() {
  return 'anon_' + Math.random().toString(36).substring(2, 15);
}

export function hasAnalyticsConsent() {
  return readString(STORAGE_KEYS.ANALYTICS_CONSENT) === 'granted';
}

export function setAnalyticsConsent(granted) {
  if (granted) {
    if (!hasAnalyticsConsent()) removeItem(STORAGE_KEYS.ANALYTICS_ID);
    writeString(STORAGE_KEYS.ANALYTICS_CONSENT, 'granted');
  } else {
    removeItem(STORAGE_KEYS.ANALYTICS_CONSENT);
    removeItem(STORAGE_KEYS.ANALYTICS_ID);
  }
}

function getAnonymousId() {
  const stored = readString(STORAGE_KEYS.ANALYTICS_ID);
  if (stored) return stored;
  const id = generateAnonymousId();
  writeString(STORAGE_KEYS.ANALYTICS_ID, id);
  return id;
}

export function trackPurchaseInitiated(contractId, tokenAmount, currency) {
  if (!hasAnalyticsConsent()) return;
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
  if (!hasAnalyticsConsent()) return;
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
