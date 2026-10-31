// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Tooltip — Consistent, accessible tooltip system for contextual help.
 *
 * Issue #302: Consistent Tooltip System for Contextual Help
 *
 * Features:
 *   - Multiple trigger types: hover, click, focus
 *   - Positioning: top, bottom, left, right with automatic collision detection
 *   - Variants: plain text, rich content (HTML/ReactNode), interactive
 *   - Keyboard navigation + screen reader support (ARIA)
 *   - Configurable show/hide delay
 *   - Smooth animations
 *   - Mobile-friendly (dismiss on outside click/tap)
 */

import React, { useState, useRef, useEffect, useCallback, useId, memo } from 'react';
import styles from './Tooltip.module.css';

const VALID_POSITIONS = ['top', 'bottom', 'left', 'right'];

/**
 * Compute the best position based on available viewport space.
 */
function getAdjustedPosition(basePosition, rect) {
  if (!rect) return basePosition;
  const padding = 16;
  const { top, bottom, left, right } = rect;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Collision detection: flip if not enough space
  if (basePosition === 'top' && top < 100) return 'bottom';
  if (basePosition === 'bottom' && vh - bottom < 100) return 'top';
  if (basePosition === 'left' && left < 200) return 'right';
  if (basePosition === 'right' && vw - right < 200) return 'left';
  return basePosition;
}

function Tooltip({
  content,
  children,
  position = 'top',
  trigger = 'hover',
  variant = 'plain',
  delay = 300,
  hideDelay = 150,
  className = '',
  contentClassName = '',
  maxWidth = 300,
  disabled = false,
  ariaLabel,
  ...rest
}) {
  const [visible, setVisible] = useState(false);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const showTimer = useRef(null);
  const hideTimer = useRef(null);
  const tooltipId = useId();

  const safePosition = VALID_POSITIONS.includes(position) ? position : 'top';

  const show = useCallback(() => {
    if (disabled) return;
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    showTimer.current = setTimeout(() => {
      // Collision detection
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setAdjustedPosition(getAdjustedPosition(safePosition, rect));
      }
      setVisible(true);
    }, delay);
  }, [disabled, delay, safePosition]);

  const hide = useCallback(() => {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
    hideTimer.current = setTimeout(() => setVisible(false), hideDelay);
  }, [hideDelay]);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') setVisible(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [visible]);

  // Close on outside click (for click trigger)
  useEffect(() => {
    if (!visible || trigger !== 'click') return;
    const handleClick = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target)
      ) {
        setVisible(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [visible, trigger]);

  const triggerHandlers = {};
  if (trigger === 'hover') {
    triggerHandlers.onMouseEnter = show;
    triggerHandlers.onMouseLeave = hide;
    triggerHandlers.onFocus = show;
    triggerHandlers.onBlur = hide;
  } else if (trigger === 'click') {
    triggerHandlers.onClick = (e) => {
      e.preventDefault();
      visible ? hide() : show();
    };
  } else if (trigger === 'focus') {
    triggerHandlers.onFocus = show;
    triggerHandlers.onBlur = hide;
  }

  return (
    <span
      ref={triggerRef}
      className={`${styles.wrapper} ${className}`}
      {...triggerHandlers}
      {...rest}
    >
      {children}
      {visible && (
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className={`${styles.tooltip} ${styles[adjustedPosition]} ${styles[variant]} ${contentClassName}`}
          style={{ maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth }}
          onMouseEnter={trigger === 'hover' ? show : undefined}
          onMouseLeave={trigger === 'hover' ? hide : undefined}
        >
          {variant === 'plain' ? (
            <span className={styles.textContent}>{content}</span>
          ) : (
            <span className={styles.richContent}>{content}</span>
          )}
          <span className={styles.arrow} aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

export default memo(Tooltip);
