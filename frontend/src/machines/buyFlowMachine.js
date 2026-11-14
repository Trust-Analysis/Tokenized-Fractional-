/**
 * Buy-flow state machine (Issue #718)
 *
 * The purchase lifecycle used to live as several independent `useState` values
 * (`isConfirming`, `purchaseStatus`, `txHash`, `errorMessage`) inside
 * `components/BuyShares/BuyShares.jsx`. Keeping them in sync by hand made the
 * flow impossible to unit test and allowed transient combinations such as
 * "processing and successful at the same time".
 *
 * This module extracts that lifecycle into a single deterministic reducer so
 * the transitions can be exercised without a DOM, a browser extension or a
 * Soroban RPC node:
 *
 *   idle ──REVIEW──▶ confirming ──CONFIRM──▶ processing ──SUCCEEDED──▶ success
 *                       │                         │                       │
 *                       │                         └─────FAILED──────────▶ error
 *                       │                                                 │
 *                       └────────────── CANCEL / RESET ───────────────────┘
 *
 * Because the flow is represented by ONE `status` string, mutually exclusive
 * states (processing && success) are mathematically impossible.
 *
 * `CANCEL` / `RESET` are intentionally ignored while `processing` so an
 * in-flight transaction can never be silently discarded from the UI.
 */

export const BuyFlowState = {
  IDLE: 'idle',
  CONFIRMING: 'confirming',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  ERROR: 'error',
};

export const BuyFlowEvent = {
  /** User opened the confirmation modal (after validation passed). */
  REVIEW: 'REVIEW',
  /** User confirmed — the transaction is submitted to the network. */
  CONFIRM: 'CONFIRM',
  /** The transaction was accepted; carries `{ txHash }`. */
  SUCCEEDED: 'SUCCEEDED',
  /** The transaction failed; carries `{ error }`. */
  FAILED: 'FAILED',
  /** User closed the modal / dismissed the result. */
  CANCEL: 'CANCEL',
  /** Hard reset back to `idle` (e.g. on unmount or asset change). */
  RESET: 'RESET',
};

/** The single source of truth for the buy flow. */
export function createInitialBuyFlowState() {
  return {
    status: BuyFlowState.IDLE,
    txHash: null,
    error: null,
  };
}

/**
 * `true` whenever the confirmation modal should be mounted, i.e. for every
 * state other than `idle`. Keeps the component's rendering decision derived
 * from the machine instead of a second boolean.
 */
export function isBuyFlowOpen(state) {
  return state.status !== BuyFlowState.IDLE;
}

/**
 * Deterministic transition function: `(state, event) -> next state`.
 * Unknown events and illegal transitions are no-ops, so the machine can never
 * reach an undefined state.
 */
export function buyFlowReducer(state, action) {
  const { type, payload } = action || {};

  switch (state.status) {
    case BuyFlowState.IDLE: {
      if (type === BuyFlowEvent.REVIEW) {
        return {
          ...state,
          status: BuyFlowState.CONFIRMING,
          txHash: null,
          error: null,
        };
      }
      break;
    }

    case BuyFlowState.CONFIRMING: {
      if (type === BuyFlowEvent.CONFIRM) {
        return {
          ...state,
          status: BuyFlowState.PROCESSING,
          txHash: null,
          error: null,
        };
      }
      if (type === BuyFlowEvent.CANCEL || type === BuyFlowEvent.RESET) {
        return createInitialBuyFlowState();
      }
      break;
    }

    case BuyFlowState.PROCESSING: {
      if (type === BuyFlowEvent.SUCCEEDED) {
        return {
          ...state,
          status: BuyFlowState.SUCCESS,
          txHash: payload?.txHash ?? null,
          error: null,
        };
      }
      if (type === BuyFlowEvent.FAILED) {
        return {
          ...state,
          status: BuyFlowState.ERROR,
          txHash: null,
          error: payload?.error || 'Transaction failed or rejected by network.',
        };
      }
      // CANCEL / RESET are deliberately ignored while the tx is in flight.
      break;
    }

    case BuyFlowState.SUCCESS: {
      if (type === BuyFlowEvent.CANCEL || type === BuyFlowEvent.RESET) {
        return createInitialBuyFlowState();
      }
      break;
    }

    case BuyFlowState.ERROR: {
      if (type === BuyFlowEvent.CONFIRM) {
        // Retry the transaction straight from the error state.
        return {
          ...state,
          status: BuyFlowState.PROCESSING,
          txHash: null,
          error: null,
        };
      }
      if (type === BuyFlowEvent.CANCEL || type === BuyFlowEvent.RESET) {
        return createInitialBuyFlowState();
      }
      break;
    }

    default:
      break;
  }

  return state;
}

export default buyFlowReducer;
