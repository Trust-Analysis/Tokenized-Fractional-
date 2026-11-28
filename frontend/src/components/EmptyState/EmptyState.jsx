// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * EmptyState — Reusable, context-aware empty state component with
 * illustrations, explanations, and call-to-action buttons.
 *
 * Issue #303: Engaging Empty State Designs with Call-to-Action
 *
 * @param {string}    title       - Headline message
 * @param {string}    description - Explanatory subtext
 * @param {string}    variant     - Preset variant: 'no-results' | 'no-transactions' | 'no-favorites' | 'no-data' | 'new-user' | 'generic'
 * @param {Array}     actions     - [{ label, onClick, variant, icon }]
 * @param {ReactNode} illustration - Custom illustration/icon override
 * @param {boolean}   isNewUser   - Show new-user onboarding messaging
 */

import React, { memo } from 'react';
import Button from '../Button/Button';
import styles from './EmptyState.module.css';

const ILLUSTRATIONS = {
  'no-results': (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  ),
  'no-transactions': (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  'no-favorites': (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" />
    </svg>
  ),
  'no-data': (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  ),
  'new-user': (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  generic: (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
};

const VARIANT_TEXT = {
  'no-results': {
    title: 'No results found',
    description: 'Try adjusting your search or filters to find what you\u2019re looking for.',
  },
  'no-transactions': {
    title: 'No transactions yet',
    description: 'Once you start buying or selling shares, your transaction history will appear here.',
  },
  'no-favorites': {
    title: 'No favorites yet',
    description: 'Click the \u2605 bookmark button on any asset card to save it here for quick access.',
  },
  'no-data': {
    title: 'Nothing here yet',
    description: 'Check back later \u2014 new content will appear here when it\u2019s available.',
  },
  'new-user': {
    title: 'Welcome to RWA Marketplace!',
    description: 'Browse available assets, connect your wallet, and start investing in fractional real-world assets.',
  },
  generic: {
    title: 'Nothing to show',
    description: 'There\u2019s nothing to display right now.',
  },
};

function EmptyState({
  title,
  description,
  variant = 'generic',
  actions = [],
  illustration,
  isNewUser = false,
  className = '',
  ...rest
}) {
  const effectiveVariant = isNewUser ? 'new-user' : variant;
  const text = VARIANT_TEXT[effectiveVariant] || VARIANT_TEXT.generic;
  const icon = illustration || ILLUSTRATIONS[effectiveVariant] || ILLUSTRATIONS.generic;

  return (
    <div
      className={`${styles.emptyState} ${styles[effectiveVariant]} ${className}`}
      role="status"
      aria-live="polite"
      {...rest}
    >
      <div className={styles.illustration} aria-hidden="true">
        {icon}
      </div>
      <h3 className={styles.title}>{title || text.title}</h3>
      <p className={styles.description}>{description || text.description}</p>
      {actions.length > 0 && (
        <div className={styles.actions}>
          {actions.map((action, idx) => (
            <Button
              key={idx}
              variant={action.variant || 'primary'}
              size={action.size || 'md'}
              onClick={action.onClick}
              className={styles.actionButton}
            >
              {action.icon && <span className={styles.actionIcon} aria-hidden="true">{action.icon}</span>}
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(EmptyState);
