/**
 * Error-mapping layer (Issue #720).
 *
 * Raw RPC/contract error strings produced by the Soroban layer — Rust `panic!()` text
 * ("Marketplace is paused"), host errors ("HostError: Error(Contract, #8)") and transport
 * failures ("TypeError: Failed to fetch") — are never shown verbatim to end users.
 * Every error is translated here into plain-language copy plus a suggested next step.
 *
 * Errors we do not recognise fall back to GENERIC_ERROR_MESSAGE, and always keep the raw
 * string available on expand so support can still see what the node actually returned.
 */

import {
  GENERIC_ERROR_MESSAGE,
  GENERIC_ERROR_NEXT_STEP,
  TX_FAILED_CHECK_BALANCE,
  TX_FAILED_NO_SHARES,
  TX_FAILED_PAUSED,
} from '../constants/errors';

export const ERROR_CATEGORIES = {
  PAUSED: 'paused',
  INSUFFICIENT_FUNDS: 'insufficient_funds',
  INSUFFICIENT_SHARES: 'insufficient_shares',
  ACCESS: 'access',
  LIMIT: 'limit',
  VALIDATION: 'validation',
  NETWORK: 'network',
  WALLET: 'wallet',
  CONFIG: 'config',
  UNKNOWN: 'unknown',
};

/** Severity hints so callers can pick a toast variant without re-classifying. */
export const ERROR_SEVERITIES = {
  WARNING: 'warning',
  ERROR: 'error',
};

/**
 * Ordered catalog of known failures. First match wins, so more specific patterns must
 * be listed before the broader ones they contain (e.g. "not enough shares available for
 * purchase" before "not enough shares"). Patterns are compared against the normalised
 * (lowercased, whitespace-collapsed) raw error text.
 */
export const ERROR_CATALOG = [
  // ── Paused / halted trading ──────────────────────────────────────────────────
  {
    code: 'MARKETPLACE_PAUSED',
    category: ERROR_CATEGORIES.PAUSED,
    severity: ERROR_SEVERITIES.WARNING,
    message: TX_FAILED_PAUSED,
    nextStep: 'Nothing is wrong on your end — the operator has halted all trading. Try again once the marketplace is resumed.',
    patterns: ['marketplace is paused', 'marketplace is currently paused'],
  },
  {
    code: 'PURCHASES_PAUSED',
    category: ERROR_CATEGORIES.PAUSED,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'Buying shares is temporarily paused.',
    nextStep: 'Selling and transfers are unaffected. Wait for the operator to reopen purchases, then try again.',
    patterns: ['purchases are currently paused', 'purchase is currently paused', 'buying is paused'],
  },
  {
    code: 'TRANSFERS_PAUSED',
    category: ERROR_CATEGORIES.PAUSED,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'Transferring shares is temporarily paused.',
    nextStep: 'You can still hold your shares. Try again once the operator resumes transfers.',
    patterns: [
      'transfers via allowance are currently paused',
      'transfers are currently paused',
      'transfer is currently paused',
    ],
  },
  {
    code: 'SELL_ORDERS_PAUSED',
    category: ERROR_CATEGORIES.PAUSED,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'Sell orders are temporarily paused.',
    nextStep: 'Buying is unaffected. Try again once the operator reopens selling.',
    patterns: ['sell orders are currently paused', 'selling is paused'],
  },
  {
    code: 'BUYBACKS_PAUSED',
    category: ERROR_CATEGORIES.PAUSED,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'Buybacks are temporarily paused.',
    nextStep: 'Try again once the operator resumes buybacks.',
    patterns: ['buybacks are currently paused'],
  },
  {
    code: 'DIVIDENDS_PAUSED',
    category: ERROR_CATEGORIES.PAUSED,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'Dividend distribution is temporarily paused.',
    nextStep: 'Any dividends already accrued are safe. Try again once distribution resumes.',
    patterns: ['dividend distribution is currently paused'],
  },
  {
    code: 'CIRCUIT_BREAKER_TRIGGERED',
    category: ERROR_CATEGORIES.PAUSED,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'Trading has been halted by the safety circuit breaker.',
    nextStep: 'This is a protective stop, usually triggered by unusual activity. Check the status page, then try again later.',
    patterns: ['circuit breaker is triggered', 'circuit breaker triggered', 'trading halted'],
  },
  {
    code: 'REENTRANCY_DETECTED',
    category: ERROR_CATEGORIES.PAUSED,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'This transaction was blocked by the contract’s reentrancy guard.',
    nextStep: 'Wait a few seconds and submit the transaction again — a previous one may still be settling.',
    patterns: ['reentrancy detected', 'reentrant call'],
  },

  // ── Not enough shares ────────────────────────────────────────────────────────
  {
    code: 'INSUFFICIENT_AVAILABLE_SHARES',
    category: ERROR_CATEGORIES.INSUFFICIENT_SHARES,
    severity: ERROR_SEVERITIES.ERROR,
    message: `${TX_FAILED_NO_SHARES} Some of the supply is already reserved or held in escrow.`,
    nextStep: 'Enter a smaller number of shares, or check the available share count on the asset page.',
    patterns: ['not enough shares available for purchase', 'not enough shares available'],
  },
  {
    code: 'INSUFFICIENT_SHARES',
    category: ERROR_CATEGORIES.INSUFFICIENT_SHARES,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'You do not have enough shares for this action.',
    nextStep: 'Reduce the amount to what your portfolio shows, or wait for any pending shares to settle.',
    patterns: [
      'insufficient shares for batch transfer',
      'insufficient liquid shares to place order',
      'insufficient shares to transfer',
      'insufficient shares',
      'not enough shares',
    ],
  },

  // ── Not enough balance ───────────────────────────────────────────────────────
  {
    code: 'INSUFFICIENT_BALANCE',
    category: ERROR_CATEGORIES.INSUFFICIENT_FUNDS,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'Your wallet does not have enough balance to cover this transaction.',
    nextStep: `${TX_FAILED_CHECK_BALANCE} Make sure you hold both the payment token and a small XLM reserve for network fees.`,
    patterns: [
      'insufficient liquid balance to lock for bridge',
      'insufficient locked balance to unlock from bridge',
      'insufficient balance',
      'insufficient funds',
      'insufficient fee',
      'insufficient xlm',
      'insufficient_balance',
      'op_insufficient_balance',
      'op_underfunded',
      'underfunded',
      'not enough balance',
      'payment would be incomplete',
      'would be incomplete',
    ],
  },

  // ── Access control / whitelist ───────────────────────────────────────────────
  {
    code: 'NOT_WHITELISTED',
    category: ERROR_CATEGORIES.ACCESS,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'This wallet is not approved to trade yet.',
    nextStep: 'Ask the operator to add your address to the whitelist, or connect with a wallet that has already traded.',
    patterns: [
      'whitelist has expired for this address',
      'address is not whitelisted',
      'both parties must be whitelisted for transfers',
      'sender must be whitelisted for transfers',
      'recipient must be whitelisted for transfers',
      'not whitelisted',
    ],
  },
  {
    code: 'TRANSFER_NOT_ALLOWED',
    category: ERROR_CATEGORIES.ACCESS,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'A transfer restriction blocked this transaction.',
    nextStep: 'Check the transfer conditions on the asset page — recipient restrictions or vesting rules may apply.',
    patterns: [
      'transfer not allowed for recipient',
      'transfer not allowed for one or both parties',
      'cannot transfer vested shares',
    ],
  },
  {
    code: 'APPROVAL_REQUIRED',
    category: ERROR_CATEGORIES.ACCESS,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'This transfer needs the owner’s approval first.',
    nextStep: 'Ask the share owner to approve the transfer, then submit it again.',
    patterns: [
      'transfer has not been approved',
      'transfer requires prior approval',
      'approval not found',
      'insufficient_approvals',
    ],
  },
  {
    code: 'NOT_AUTHORIZED',
    category: ERROR_CATEGORIES.ACCESS,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'Your wallet is not authorised to perform this action.',
    nextStep: 'Admin-only actions have to be run by the contract administrator. Connect with an admin wallet or contact the operator.',
    patterns: ['not authorized', 'not authorised', 'not_a_curator', 'notacurator'],
  },
  {
    code: 'VESTING_LOCKED',
    category: ERROR_CATEGORIES.ACCESS,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'These shares are still locked by a vesting schedule.',
    nextStep: 'Wait until the lock expires, or transfer only the liquid portion of your holding.',
    patterns: [
      'transfer restricted until timestamp',
      'transfer amount exceeds maximum allowed',
      'no vested shares available to claim',
    ],
  },

  // ── Purchase limits ──────────────────────────────────────────────────────────
  {
    code: 'PURCHASE_LIMIT_EXCEEDED',
    category: ERROR_CATEGORIES.LIMIT,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'This purchase is over your buying limit.',
    nextStep: 'Buy a smaller amount, or wait until the next limit window resets (daily, weekly or monthly).',
    patterns: [
      'purchase exceeds max shares per user',
      'purchase exceeds per-transaction share limit',
      'purchase exceeds per-transaction value limit',
      'purchase would exceed daily share limit',
      'purchase would exceed daily value limit',
      'purchase would exceed weekly share limit',
      'purchase would exceed monthly value limit',
    ],
  },

  // ── Order book ───────────────────────────────────────────────────────────────
  {
    code: 'ORDER_NOT_FOUND',
    category: ERROR_CATEGORIES.VALIDATION,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'That order no longer exists.',
    nextStep: 'Refresh the order book — it may have been filled or cancelled by someone else.',
    patterns: ['order not found', 'amount exceeds order size'],
  },

  // ── Amount / price validation ────────────────────────────────────────────────
  {
    code: 'INVALID_AMOUNT',
    category: ERROR_CATEGORIES.VALIDATION,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'That amount is not valid.',
    nextStep: 'Enter a whole number greater than 0 and try again.',
    patterns: [
      'must purchase at least 1 share',
      'purchase amount must be positive',
      'order amount must be positive',
      'order price must be positive',
      'transfer amount must be positive',
      'bridge lock amount must be greater than zero',
      'bridge unlock amount must be greater than zero',
      'dividend amount must be positive',
      'dividend total amount must be positive',
      'invalid_amount',
    ],
  },
  {
    code: 'INVALID_PRICE',
    category: ERROR_CATEGORIES.CONFIG,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'The share price is not set to a usable value.',
    nextStep: 'This is a marketplace configuration issue. Contact the operator to have the price corrected.',
    patterns: [
      'price must be positive',
      'new total must be at least available shares',
      'new total cannot be less than issued shares',
      'invalid pricing model',
    ],
  },
  {
    code: 'INVALID_PAYMENT_TOKEN',
    category: ERROR_CATEGORIES.CONFIG,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'This payment token is not accepted by the marketplace.',
    nextStep: 'Pick one of the accepted payment tokens on the buy form. If none are listed, the operator needs to enable one first.',
    patterns: [
      'cannot remove the default payment token',
      'token not in accepted list',
      'payment token not accepted',
      'token_not_accepted',
      'token already accepted',
    ],
  },
  {
    code: 'DIVIDEND_NOT_DUE',
    category: ERROR_CATEGORIES.VALIDATION,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'No dividends are ready to claim yet.',
    nextStep: 'Come back after the next distribution interval has elapsed.',
    patterns: [
      'dividend interval has not elapsed yet',
      'ledger timestamp is in the past relative to last distribution',
      'no accrued dividends available to claim',
      'no shares have been issued',
      'no holders registered',
    ],
  },
  {
    code: 'CONTRACT_NOT_INITIALIZED',
    category: ERROR_CATEGORIES.CONFIG,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'The marketplace contract is not fully set up yet.',
    nextStep: 'This is an operator issue. Verify the contract address is correct, or contact the marketplace operator.',
    patterns: [
      'contract not initialized',
      'marketplace is already initialized',
      'already_initialized',
      'not_initialized',
    ],
  },
  {
    code: 'ARITHMETIC_ERROR',
    category: ERROR_CATEGORIES.CONFIG,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'The transaction overflowed the contract’s arithmetic limits.',
    nextStep: 'Try a smaller amount. If it still fails, contact support — the contract state may need attention.',
    patterns: ['arithmetic overflow', 'arithmetic underflow'],
  },

  // ── Wallet / signing ─────────────────────────────────────────────────────────
  {
    code: 'USER_REJECTED',
    category: ERROR_CATEGORIES.WALLET,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'You cancelled the request in your wallet.',
    nextStep: 'No funds moved. Reopen your wallet and approve the transaction when you are ready.',
    patterns: [
      'user declined',
      'user rejected',
      'user canceled',
      'user cancelled',
      'request rejected',
      'denied by user',
    ],
  },
  {
    code: 'WALLET_NOT_CONNECTED',
    category: ERROR_CATEGORIES.WALLET,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'Your wallet is not connected.',
    nextStep: 'Reconnect your wallet and try again.',
    patterns: ['wallet not connected', 'no public key returned', 'account not found', 'wallet is locked'],
  },
  {
    code: 'SIGNING_FAILED',
    category: ERROR_CATEGORIES.WALLET,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'Your wallet could not sign this transaction.',
    nextStep: 'Unlock your wallet, switch to the correct network, and try signing again.',
    patterns: [
      'signing failed',
      'failed to sign',
      'sign error',
      'user must sign',
    ],
  },

  // ── RPC / transport ──────────────────────────────────────────────────────────
  {
    code: 'RPC_UNREACHABLE',
    category: ERROR_CATEGORIES.NETWORK,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'We could not reach the Stellar network.',
    nextStep: 'Check your internet connection and try again. The RPC endpoint may also be temporarily down.',
    patterns: [
      'failed to fetch',
      'networkerror',
      'network request failed',
      'network error',
      'err_network',
      'econnrefused',
      'err_connection',
      'enotfound',
      'err_internet_disconnected',
      'rpc connection failed',
      'cannot fetch rpc data',
    ],
  },
  {
    code: 'RPC_RATE_LIMITED',
    category: ERROR_CATEGORIES.NETWORK,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'The network is busy right now.',
    nextStep: 'Wait about a minute before trying again — too many requests are hitting the RPC endpoint.',
    patterns: ['429', 'too many requests', 'rate limit', 'rate_limit'],
  },
  {
    code: 'RPC_UNAVAILABLE',
    category: ERROR_CATEGORIES.NETWORK,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'The network is temporarily unavailable.',
    nextStep: 'Soroban is likely under maintenance. Check status.stellar.org and try again shortly.',
    patterns: ['503', 'service unavailable', 'bad gateway', '502', '504', 'gateway timeout'],
  },
  {
    code: 'RPC_TIMEOUT',
    category: ERROR_CATEGORIES.NETWORK,
    severity: ERROR_SEVERITIES.WARNING,
    message: 'The network took too long to respond.',
    nextStep: 'Soroban transactions can take up to 30 seconds. Wait a moment and check your activity before resubmitting.',
    patterns: [
      'transaction submitted but result not available',
      'request timed out',
      'etimedout',
      'timeout of',
      'aborted',
    ],
  },
  {
    code: 'BAD_SEQUENCE',
    category: ERROR_CATEGORIES.NETWORK,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'Your account sequence is out of date.',
    nextStep: 'Reload the page to refresh your account state, then submit the transaction again.',
    patterns: ['tx_bad_seq', 'tx_too_early', 'bad sequence', 'too early'],
  },
  {
    code: 'TRANSACTION_FAILED',
    category: ERROR_CATEGORIES.NETWORK,
    severity: ERROR_SEVERITIES.ERROR,
    message: 'The network rejected this transaction.',
    nextStep: 'The transaction did not go through and no funds moved. Try again in a moment.',
    patterns: ['tx_failed', 'txinternalerror', 'internal error', 'transaction failed'],
  },
];

/**
 * Numeric `#[contracterror]` codes from contracts/multi_asset/src/lib.rs. Soroban
 * surfaces these as "HostError: Error(Contract, #8)" with no accompanying text.
 */
export const CONTRACT_ERROR_CODES = {
  1: { code: 'NOT_AUTHORIZED', message: 'Your wallet is not authorised to perform this action.', nextStep: 'Admin-only actions have to be run by the contract administrator. Contact the marketplace operator.' },
  2: { code: 'ALREADY_INITIALIZED', message: 'This asset has already been created.', nextStep: 'Open the existing asset instead of creating a new one.' },
  3: { code: 'NOT_INITIALIZED', message: 'The contract is not fully set up yet.', nextStep: 'This is an operator issue. Verify the contract address is correct, or contact the marketplace operator.' },
  4: { code: 'ASSET_NOT_FOUND', message: 'That asset could not be found.', nextStep: 'It may have been archived. Refresh the page and pick another asset.' },
  5: { code: 'ASSET_ALREADY_ACTIVE', message: 'This asset is already active.', nextStep: 'No action needed — open the asset to buy shares.' },
  6: { code: 'ASSET_ALREADY_INACTIVE', message: 'This asset is already inactive.', nextStep: 'No action needed — the asset is already paused.' },
  7: { code: 'ASSET_ARCHIVED', message: 'This asset has been archived and can no longer be traded.', nextStep: 'Choose one of the active assets instead.' },
  8: { code: 'INSUFFICIENT_SHARES', message: 'You do not have enough shares for this action.', nextStep: 'Reduce the amount to what your portfolio shows, or wait for any pending shares to settle.' },
  9: { code: 'INVALID_AMOUNT', message: 'That amount is not valid.', nextStep: 'Enter a whole number greater than 0 and try again.' },
  10: { code: 'INVALID_PRICING_MODEL', message: 'The asset uses a pricing model that does not support this action.', nextStep: 'Contact the operator if you believe this is a mistake.' },
  11: { code: 'TOKEN_NOT_ACCEPTED', message: 'This payment token is not accepted by the marketplace.', nextStep: 'Pick one of the accepted payment tokens on the buy form.' },
  12: { code: 'TRANSFER_FAILED', message: 'The token transfer did not go through.', nextStep: 'No funds moved. Try again in a moment.' },
  13: { code: 'ASSET_COUNT_EXHAUSTED', message: 'This contract has no room for more assets.', nextStep: 'Contact the operator to have capacity added.' },
  14: { code: 'NAME_TOO_LONG', message: 'That asset name is too long.', nextStep: 'Shorten the name and save again.' },
  15: { code: 'TREASURY_NOT_SET', message: 'No treasury has been set for this asset yet.', nextStep: 'The operator needs to configure a treasury before trading can start.' },
  16: { code: 'INVALID_CURATOR_SET', message: 'The list of curators for this asset is invalid.', nextStep: 'Contact the operator to correct the curator list.' },
  17: { code: 'INSUFFICIENT_APPROVALS', message: 'This transfer needs the owner’s approval first.', nextStep: 'Ask the share owner to approve the transfer, then submit it again.' },
  18: { code: 'NOT_A_CURATOR', message: 'Your wallet is not a curator for this asset.', nextStep: 'Only curators can perform this action. Ask an existing curator to run it.' },
};

const HOST_ERROR_CODE_PATTERN = /error\s*\(\s*contract\s*,\s*#\s*(\d+)\s*\)|hosterror:\s*#\s*(\d+)/i;

/** Pull a human-readable raw string out of whatever the RPC/SDK layer threw at us. */
export function extractRawMessage(error) {
  if (error == null) return '';
  if (typeof error === 'string') return error.trim();

  const candidates = [
    error.message,
    error.error,
    error.detail,
    error.reason,
    error.cause?.message,
    error.cause,
    error.statusText,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === 'object' && typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message.trim();
    }
  }

  return '';
}

const normalize = (raw) => raw.toLowerCase().replace(/\s+/g, ' ').trim();

/** Numeric contract error code embedded in a Soroban host error, if any. */
export function extractContractErrorCode(raw) {
  const match = HOST_ERROR_CODE_PATTERN.exec(raw);
  if (!match) return null;
  const code = Number.parseInt(match[1] ?? match[2], 10);
  return Number.isNaN(code) ? null : code;
}

function buildFallback(raw, context) {
  return {
    code: 'UNKNOWN_ERROR',
    category: ERROR_CATEGORIES.UNKNOWN,
    severity: ERROR_SEVERITIES.ERROR,
    message: GENERIC_ERROR_MESSAGE,
    nextStep: GENERIC_ERROR_NEXT_STEP,
    isKnown: false,
    raw,
    operation: context.operation ?? null,
  };
}

function matchCatalogEntry(normalizedRaw) {
  return (
    ERROR_CATALOG.find((entry) => entry.patterns.some((pattern) => normalizedRaw.includes(pattern))) ??
    null
  );
}

/**
 * Translate any thrown value into user-facing copy.
 *
 * @param {unknown} error   Error, string, or RPC response object from the Soroban layer.
 * @param {object} [context] Optional `{ operation, action }` metadata.
 * @returns {{
 *   code: string, category: string, severity: string,
 *   message: string, nextStep: string, isKnown: boolean, raw: string, operation: string|null,
 * }}
 */
export function mapError(error, context = {}) {
  const raw = extractRawMessage(error);

  if (!raw) return buildFallback('', context);

  const contractCode = extractContractErrorCode(raw);
  if (contractCode != null && CONTRACT_ERROR_CODES[contractCode]) {
    const known = CONTRACT_ERROR_CODES[contractCode];
    return {
      code: known.code,
      category: categoryForCode(known.code),
      severity: ERROR_SEVERITIES.ERROR,
      message: known.message,
      nextStep: known.nextStep,
      isKnown: true,
      raw,
      operation: context.operation ?? null,
    };
  }

  const entry = matchCatalogEntry(normalize(raw));
  if (!entry) return buildFallback(raw, context);

  return {
    code: entry.code,
    category: entry.category,
    severity: entry.severity,
    message: entry.message,
    nextStep: entry.nextStep,
    isKnown: true,
    raw,
    operation: context.operation ?? null,
  };
}

function categoryForCode(code) {
  const entry = ERROR_CATALOG.find((candidate) => candidate.code === code);
  return entry ? entry.category : ERROR_CATEGORIES.UNKNOWN;
}

/** Convenience wrapper when only the headline copy is needed. */
export function getErrorMessage(error, context = {}) {
  return mapError(error, context).message;
}

/** Headline copy plus the suggested next step, as a single sentence pair. */
export function getErrorMessageWithNextStep(error, context = {}) {
  const { message, nextStep } = mapError(error, context);
  return nextStep ? `${message} ${nextStep}` : message;
}

/**
 * Shape a mapped error into an `addToast` payload. The raw error is only attached for
 * unmapped (generic) failures, where it is the only clue support has to work with.
 */
export function toToastError(error, context = {}) {
  const mapped = mapError(error, context);
  const payload = {
    message: mapped.message,
    type: mapped.severity === ERROR_SEVERITIES.WARNING ? 'warning' : 'error',
  };

  if (mapped.nextStep) payload.nextSteps = mapped.nextStep;
  if (!mapped.isKnown && mapped.raw) payload.details = mapped.raw;

  return payload;
}

export function isKnownError(error) {
  return mapError(error).isKnown;
}
