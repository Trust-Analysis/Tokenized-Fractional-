// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT
// Issue #194 – Keyboard shortcuts

import { useEffect, useCallback } from 'react';

/**
 * Keyboard shortcut map.
 * Each entry defines: { key, ctrlKey, description, action }.
 */
export const SHORTCUT_MAP = [
  { key: 'k', ctrlKey: true, description: 'Open search', id: 'search' },
  { key: 'b', ctrlKey: true, description: 'Open portfolio', id: 'portfolio' },
  { key: 'h', ctrlKey: true, description: 'Go to home', id: 'home' },
  { key: '/', ctrlKey: true, description: 'Show shortcut help', id: 'help' },
  { key: 'Escape', ctrlKey: false, description: 'Close modal / dismiss', id: 'escape' },
];

/**
 * useKeyboardShortcuts
 *
 * Registers global keyboard shortcuts and fires the provided handlers.
 *
 * @param {Object} handlers - Map of shortcut id → callback function
 *   Supported ids: 'search' | 'portfolio' | 'home' | 'help' | 'escape'
 * @param {boolean} [enabled=true] - Whether shortcuts are active
 */
export function useKeyboardShortcuts(handlers = {}, enabled = true) {
  const handleKeyDown = useCallback(
    (e) => {
      if (!enabled) return;

      // Do not fire shortcuts when the user is typing in an input / textarea
      const tag = e.target?.tagName?.toUpperCase();
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;

      for (const shortcut of SHORTCUT_MAP) {
        const ctrlMatch = shortcut.ctrlKey ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey;
        const keyMatch = e.key === shortcut.key;

        if (ctrlMatch && keyMatch) {
          // Allow Escape regardless of focus; block Ctrl+combos in inputs
          if (shortcut.id !== 'escape' && isInput) continue;

          const handler = handlers[shortcut.id];
          if (typeof handler === 'function') {
            e.preventDefault();
            handler(e);
          }
          return;
        }
      }
    },
    [handlers, enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);
}
