# feat: Add confirmation modal before buying shares

## Summary

Adds a confirmation modal dialog that intercepts the "Buy Shares" action and displays a purchase summary — number of shares, price per share (fetched live from the contract), and total cost — before the user authorizes the transaction. This prevents accidental purchases by requiring an explicit confirmation step.

---

## What Changed

### New: `Modal` component (`frontend/src/components/Modal/`)

A minimal, reusable modal primitive built with React `createPortal`:

| Prop | Type | Description |
|---|---|---|
| `title` | `string` | Heading rendered at the top of the modal |
| `children` | `ReactNode` | Body content |
| `actions` | `ReactNode` | Footer action buttons |
| `onClose` | `() => void` | Called on Escape key or overlay click |

Accessibility: `role="dialog"`, `aria-modal="true"`, `aria-label` from `title`, keyboard-dismissible (Escape), click-outside-dismissible.

**Files:**
- `Modal.jsx` — portal wrapper with overlay, keyboard & click-outside close
- `Modal.module.css` — overlay backdrop + slide-up animation

---

### New: `ConfirmPurchase` component (`frontend/src/components/ConfirmPurchase/`)

Uses `Modal` to display a structured purchase summary:

| Row | Value |
|---|---|
| Shares | The quantity entered by the user |
| Price per share | Live contract value, formatted from stroops → XLM (1 stroop = 10⁻⁷ XLM) |
| **Total cost** | `pricePerShare × shares`, same XLM formatting, highlighted in primary color |

Has **Confirm** (primary) and **Cancel** (secondary) buttons. The Confirm button shows a loading spinner while the transaction is in flight.

**Files:**
- `ConfirmPurchase.jsx` — renders `Modal` with the summary table and action buttons
- `ConfirmPurchase.module.css` — table layout, row separators, total row highlight

---

### Modified: `frontend/src/App.jsx`

Three changes:

1. **`get_price` hook** — added `useSorobanRead('get_price', [])` to fetch the current share price from the contract on mount. Result decoded via `.retval.u64()`.

2. **`handleBuyShares` → modal gate** — the function now only validates the amount and sets `confirmPending = true` (opens the modal). It no longer fires the transaction directly.

3. **`handleConfirmBuy`** — new async function that executes the `buy_shares` transaction (moved from the old `handleBuyShares`), then closes the modal on success or error.

4. **`ConfirmPurchase` rendered** — conditionally rendered at the bottom of the JSX tree when `confirmPending` is `true`, receiving `shares`, `pricePerShare`, `onConfirm`, `onCancel`, and `loading` props.

---

## User Flow

```
User enters share amount → clicks "Buy Shares"
  → Modal opens showing:
      Shares:          5
      Price per share: 1.00 XLM
      Total cost:      5.00 XLM
  → [Cancel] closes modal, no action
  → [Confirm] fires buy_shares transaction
              button shows spinner while pending
              modal closes after submit
              toast shows tx status
```

---

## Checklist

- [x] Create a reusable Modal component
- [x] Create a ConfirmPurchase modal with share summary
- [x] Wire it before handleBuyShares
- [x] Show price per share and total cost
- [x] Handle confirm and cancel actions
- [x] Build passes (`vite build` — 615 modules, no new errors)

---

## Files Changed

| File | Change |
|---|---|
| `frontend/src/components/Modal/Modal.jsx` | New — reusable portal modal |
| `frontend/src/components/Modal/Modal.module.css` | New — overlay + animation styles |
| `frontend/src/components/ConfirmPurchase/ConfirmPurchase.jsx` | New — purchase summary modal |
| `frontend/src/components/ConfirmPurchase/ConfirmPurchase.module.css` | New — summary table styles |
| `frontend/src/App.jsx` | Modified — `get_price` hook, modal gate in `handleBuyShares`, `handleConfirmBuy`, modal render |

---

closes #93
