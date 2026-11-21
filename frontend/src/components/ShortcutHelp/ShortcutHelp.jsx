// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT
// Issue #194 – Shortcut Help Modal

import React from 'react';
import Modal from '../Modal/Modal';
import { SHORTCUT_MAP } from '../../hooks/useKeyboardShortcuts';
import styles from './ShortcutHelp.module.css';

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

function formatKey(shortcut) {
  if (shortcut.key === 'Escape') return 'Esc';
  if (shortcut.key === '/') return '/';
  return shortcut.key.toUpperCase();
}

/**
 * ShortcutHelpModal
 *
 * Renders the keyboard shortcuts reference table inside the existing Modal component.
 *
 * @param {boolean} open - Whether the modal is visible
 * @param {function} onClose - Called when the user closes the modal
 */
export default function ShortcutHelpModal({ open, onClose }) {
  if (!open) return null;

  return (
    <Modal title="⌨️ Keyboard Shortcuts" onClose={onClose}>
      <table className={styles.table} aria-label="Keyboard shortcuts reference">
        <thead>
          <tr>
            <th className={styles.th}>Shortcut</th>
            <th className={styles.th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUT_MAP.map((s) => (
            <tr key={s.id} className={styles.row}>
              <td className={styles.keys}>
                {s.ctrlKey && (
                  <>
                    <kbd className={styles.kbd}>{MOD}</kbd>
                    <span className={styles.plus}>+</span>
                  </>
                )}
                <kbd className={styles.kbd}>{formatKey(s)}</kbd>
              </td>
              <td className={styles.desc}>{s.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.hint}>Press <kbd className={styles.kbd}>Esc</kbd> to close</p>
    </Modal>
  );
}
