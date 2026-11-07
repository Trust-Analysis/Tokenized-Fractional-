# React Performance Optimization Strategy

## Issue #306: React Performance Optimization with Memoization

This document outlines the memoization strategy implemented across the RWA Marketplace frontend.

## Memoization Techniques Applied

### 1. React.memo (Component-level memoization)
Components wrapped in `React.memo` to prevent unnecessary re-renders when props haven't changed:
- `AssetCard` — memoized; only re-renders when the `asset` prop changes
- `AssetGrid` — memoized; only re-renders when `assets`, `loading`, `error`, or `isEmpty` change
- `EmptyState` — memoized; only re-renders when props change
- `OptimizedImage` — memoized; only re-renders when `src` or `alt` change
- `MarketplacePage` — memoized; only re-renders when relevant props change

### 2. useMemo (Value memoization)
Used for expensive computations:
- `fetchSharesArgs` — memoized Soroban call arguments
- `isTestnet` — memoized network check

### 3. useCallback (Function reference stability)
Used for handler functions passed as props:
- `connectWallet` — stable reference prevents child re-renders
- `disconnectWallet` — stable reference
- `handleBuyShares` — stable reference

## Guidelines

### When to use React.memo
- Use for components that render frequently and receive stable props
- Use for components in lists (e.g., list items)
- Avoid for components that always re-render (e.g., those using context that changes often)

### When to use useMemo
- Use for expensive calculations (filtering, sorting, transforming large arrays)
- Use for complex object/array constructions passed as props
- Avoid for primitive values or trivial calculations

### When to use useCallback
- Use for functions passed as props to memoized children
- Use for functions in dependency arrays of useEffect/useMemo
- Avoid for functions only used within the same component

## Performance Budgets
- Component render time: < 16ms (60fps)
- Initial bundle size: reduce via code splitting (Issue #304)
- List rendering: use virtualization for 100+ items (Issue #307)

## Monitoring
- Use React DevTools Profiler to identify unnecessary re-renders
- Track Core Web Vitals (LCP, FID, CLS) in production
- Set up performance regression detection in CI
