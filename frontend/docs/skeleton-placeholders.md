# Skeleton Placeholders for Asset Loading

Skeleton components provide animated loading placeholders while Soroban RPC data is being fetched. This guide explains the implementation and usage.

## Overview

The frontend has two skeleton systems:

1. **Skeleton** — Low-level component for generic placeholder shapes (text, rect, circle)
2. **AssetSkeleton** — High-level component specifically for marketplace asset data

## Architecture

### Skeleton Component

The base `Skeleton` component renders animated placeholder shapes that match the actual content.

**Variants:**
- `text` — Text line placeholder (default height: 1em)
- `rect` — Rectangle placeholder (default height: 1rem)
- `circle` — Circle placeholder (default size: 48px)

**Multi-line text:**
```jsx
<Skeleton variant="text" lines={3} />  // 3 stacked text lines
```

**Custom styling:**
```jsx
<Skeleton 
  variant="rect" 
  width="200px" 
  height="150px" 
  style={{ borderRadius: '8px' }}
/>
```

### Skeleton Animation

All skeletons use the same **shimmer animation**:

```css
@keyframes shimmer {
  0% {
    background-position: -400px 0;
  }
  100% {
    background-position: 400px 0;
  }
}

animation: shimmer 1.6s ease-in-out infinite;
```

The animation:
- **Duration:** 1.6 seconds
- **Speed:** ease-in-out (starts slow, accelerates, then slows)
- **Repeat:** infinite (continuous loop)
- **Visual effect:** Left-to-right light sweep across the placeholder

### AssetSkeleton Component

High-level component that combines multiple skeletons to match the marketplace asset card layout.

**Renders:**
- Asset image placeholder (200px height)
- Asset title (text skeleton, 75% width)
- Location (text skeleton, 60% width)
- Description (3-line text skeleton)
- Valuation (text skeleton, 50% width)
- Share price section
- Holdings and buy section

**Usage:**
```jsx
import AssetSkeleton from './components/AssetSkeleton/AssetSkeleton';

// Show while loading
{loading ? (
  <AssetSkeleton />
) : (
  <AssetCard data={data} />
)}
```

## Theme Support

Both skeleton components automatically adapt to light and dark themes via CSS custom properties.

### Dark Theme (default)
```css
[data-theme='dark'] .skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-surface-hover, #1b2336) 25%,
    rgba(255, 255, 255, 0.06) 50%,
    var(--bg-surface-hover, #1b2336) 75%
  );
}
```

**Visual:** Dark gray base with subtle light sweep

### Light Theme
```css
[data-theme='light'] .skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-surface-hover, #f1f5f9) 25%,
    rgba(0, 0, 0, 0.04) 50%,
    var(--bg-surface-hover, #f1f5f9) 75%
  );
}
```

**Visual:** Light gray base with subtle dark sweep

### Testing Themes

Set the `data-theme` attribute on the root element:

```jsx
// In your component or test
document.documentElement.setAttribute('data-theme', 'light');
document.documentElement.setAttribute('data-theme', 'dark');
```

Or use the theme toggle in the app header to switch at runtime.

## Integration in Marketplace

### Asset Loading States

The marketplace shows `AssetSkeleton` while any of these loading states are active:

```jsx
{loadingMeta || loadingPrice || loadingShares ? (
  <AssetSkeleton />
) : assetMeta ? (
  <AssetCard />
) : null}
```

**Loading sources:**
- `loadingMeta` — Asset metadata being fetched from backend API
- `loadingPrice` — Share price being fetched via `useSorobanRead('get_price')`
- `loadingShares` — User's share balance being fetched via `useSorobanRead('get_shares')`

### Soroban RPC Loading

The `useSorobanRead` hook returns a `loading` boolean that indicates when the RPC call is in-flight:

```jsx
const { data: priceData, loading: loadingPrice } = useSorobanRead(
  'get_price',
  [],
  { skip: CONTRACT_ID.length < 50 }
);
```

Once the RPC call completes (success or error), `loading` becomes `false` and the actual data is displayed.

## Responsive Design

Skeletons adapt to different screen sizes:

**Desktop (>768px):**
- Standard spacing and sizes
- Full-width cards

**Tablet (481px - 768px):**
- Reduced padding (1rem instead of 1.5rem)
- Smaller image heights (150px)

**Mobile (<480px):**
- Minimal padding (0.75rem)
- Stacked layouts
- Small image heights (120px)

## CSS Customization

### Custom Colors

Override CSS variables in your theme:

```css
:root {
  --bg-surface-hover: #e0e0e0;  /* Light theme base color */
}

[data-theme='dark'] {
  --bg-surface-hover: #1b2336;  /* Dark theme base color */
}
```

### Custom Animation Speed

Adjust shimmer speed in Skeleton.module.css:

```css
@keyframes shimmer {
  /* ... */
  animation: shimmer 1.2s ease-in-out infinite;  /* faster: 1.2s instead of 1.6s */
}
```

### Custom Variants

Create additional skeleton styles by extending Skeleton.module.css:

```css
.skeleton.custom {
  border-radius: 50%;
  width: 100px;
  height: 100px;
}
```

Then use in React:

```jsx
<Skeleton variant="custom" className="custom" />
```

## Accessibility

All skeleton elements include `aria-hidden="true"` to hide them from screen readers, since they're purely visual loading indicators and not meaningful content.

```jsx
<span
  className={styles.skeleton}
  aria-hidden="true"  // Hidden from assistive tech
/>
```

## Performance Considerations

### Animation Performance

- Shimmer uses `background-position` which is GPU-accelerated
- **No layout shift:** Background animation doesn't trigger reflows
- **Smooth 60fps:** Hardware acceleration ensures smooth animation

### Memory

- Skeletons are lightweight (simple DOM elements)
- CSS animation is GPU-rendered (no JavaScript)
- Multiple skeletons on-page have minimal overhead

### Best Practices

1. **Show skeletons only during loading**
   ```jsx
   {loading && <AssetSkeleton />}  // Good
   {<AssetSkeleton />}  // Bad: always renders
   ```

2. **Match skeleton width to content**
   ```jsx
   <Skeleton width="200px" />  // Good: matches card width
   <Skeleton />  // OK: defaults to 100%
   ```

3. **Use appropriate line counts**
   ```jsx
   <Skeleton variant="text" lines={3} />  // Good: 3 lines of text
   <Skeleton variant="text" />  // OK: 1 line
   ```

## Storybook Stories

View skeleton components in Storybook:

```bash
npm run storybook
# Navigate to: Components > AssetSkeleton
```

**Available stories:**
- **DarkTheme** — AssetSkeleton in dark theme
- **LightTheme** — AssetSkeleton in light theme
- **MultipleSkeletons** — Multiple skeletons (dark theme)
- **LightThemeMultiple** — Multiple skeletons (light theme)

## Browser Support

Skeleton animation works in all modern browsers:
- Chrome 43+
- Firefox 16+
- Safari 9+
- Edge 12+

CSS custom properties (variables) require:
- Chrome 49+
- Firefox 31+
- Safari 9.1+
- Edge 15+

## Troubleshooting

### Skeleton Not Animating

**Problem:** Shimmer animation is static (no movement)

**Causes:**
1. Theme not set: Ensure `data-theme` attribute is on root element
2. CSS not loaded: Check that `Skeleton.module.css` is imported
3. Browser support: Very old browsers (<2015) may not support CSS variables

**Solution:**
```jsx
// Ensure theme is set
useEffect(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
}, []);
```

### Skeleton Color Mismatch

**Problem:** Skeleton color doesn't match theme

**Cause:** Theme switched but skeleton wasn't re-rendered

**Solution:** Skeleton re-renders automatically when theme changes. If not, verify:
1. Theme toggle sets `data-theme` attribute correctly
2. CSS selectors match (e.g., `[data-theme='dark'] .skeleton`)

### Layout Shift When Content Loads

**Problem:** Content appears in different position than skeleton

**Cause:** Skeleton dimensions don't match actual content

**Solution:** Set skeleton dimensions to match content:
```jsx
// Bad: skeleton is 100px but content is 150px
<AssetSkeleton />  // vs  <AssetCard height="150px" />

// Good: skeleton dimensions match content
<Skeleton height="150px" />  // vs  <AssetCard height="150px" />
```

## Related Components

- **Skeleton** (`Skeleton.jsx`) — Base skeleton component
- **AssetSkeleton** (`AssetSkeleton.jsx`) — Marketplace asset loading placeholder
- **useSorobanRead** (`useSoroban.js`) — Hook that provides `loading` state
- **Card** (`Card.jsx`) — Container for asset data (matches AssetSkeleton layout)

## Further Reading

- [Skeleton Screens](https://www.nngroup.com/articles/skeleton-screens/) — UX article by Nielsen Norman Group
- [CSS Animations](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Animations) — MDN reference
- [CSS Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/--*) — MDN reference
