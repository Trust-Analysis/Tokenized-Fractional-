// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Breadcrumbs — Breadcrumb navigation for user orientation.
 *
 * Issue #301: Implement Breadcrumb Navigation for User Orientation
 *
 * Features:
 *   - Auto-generates trail from route structure or custom items
 *   - Consistent placement below main navigation
 *   - Clickable items (except current page)
 *   - Hover states + ARIA labels for accessibility
 *   - Deep nesting truncation with ellipses
 *   - schema.org structured data for SEO
 *   - Configurable: exclude routes, custom labels
 *   - Responsive: collapses on small screens
 */

import React, { memo } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import styles from './Breadcrumbs.module.css';

const MAX_VISIBLE = 5; // Maximum visible crumbs before truncation

// Route path → human-readable label mapping
const DEFAULT_LABELS = {
  '': 'Home',
  '/': 'Home',
  marketplace: 'Marketplace',
  portfolio: 'Portfolio',
  admin: 'Admin',
  history: 'History',
  compare: 'Compare',
  favorites: 'Favorites',
  profile: 'Profile',
  assets: 'Assets',
  settings: 'Settings',
};

// Routes to exclude from breadcrumbs
const DEFAULT_EXCLUDES = [''];

function Breadcrumbs({
  items,
  labels = {},
  excludes = DEFAULT_EXCLUDES,
  maxVisible = MAX_VISIBLE,
  showSchema = true,
  className = '',
  separator = '/',
  ...rest
}) {
  const location = useLocation();
  const navigate = useNavigate();

  // Generate crumbs from location if no custom items provided
  const crumbs = items || generateCrumbs(location, { ...DEFAULT_LABELS, ...labels }, excludes);

  if (crumbs.length <= 1) return null;

  // Truncate deep trails with ellipses
  const displayCrumbs = crumbs.length > maxVisible
    ? [
        crumbs[0],
        { label: '...', truncated: true, items: crumbs.slice(1, -1) },
        crumbs[crumbs.length - 1],
      ]
    : crumbs;

  // Build schema.org structured data
  const schemaData = showSchema
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((crumb, idx) => ({
          '@type': 'ListItem',
          position: idx + 1,
          name: crumb.label,
          item: crumb.path ? `${window.location.origin}${crumb.path}` : undefined,
        })),
      }
    : null;

  return (
    <nav
      className={`${styles.breadcrumbs} ${className}`}
      aria-label="Breadcrumb navigation"
      role="navigation"
      {...rest}
    >
      {schemaData && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaData) }} />
      )}
      <ol className={styles.list}>
        {displayCrumbs.map((crumb, idx) => {
          const isLast = idx === displayCrumbs.length - 1;
          const isTruncated = crumb.truncated;

          return (
            <li key={`${crumb.label}-${idx}`} className={styles.item}>
              {!isLast && (
                <span className={styles.separator} aria-hidden="true">
                  {separator}
                </span>
              )}
              {isLast || isTruncated ? (
                <span
                  className={styles.current}
                  aria-current="page"
                  title={isTruncated ? crumb.items?.map((c) => c.label).join(' › ') : crumb.label}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.path}
                  className={styles.link}
                  aria-label={`Navigate to ${crumb.label}`}
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Generate breadcrumb crumbs from the current location.
 * Since the app uses view-based navigation, we derive crumbs from query params
 * or the hash, falling back to a simple Home > Current pattern.
 */
function generateCrumbs(location, labels, excludes) {
  const crumbs = [{ label: labels[''] || 'Home', path: '/' }];

  // Check for view in query params or hash
  const params = new URLSearchParams(location.search);
  const view = params.get('view') || location.hash.replace('#', '') || 'marketplace';

  const label = labels[view] || labels[location.pathname] || capitalize(view);
  if (label && !excludes.includes(view)) {
    crumbs.push({
      label,
      path: `/?view=${view}`,
    });
  }

  return crumbs;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default memo(Breadcrumbs);
