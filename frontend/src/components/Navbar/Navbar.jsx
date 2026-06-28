import React, { useState, useEffect, useRef } from 'react';
import styles from './Navbar.module.css';

const NAV_ITEMS = [
  {
    id: 'marketplace',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>
    ),
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M20 21a8 8 0 1 0-16 0" />
        <circle cx="19" cy="19" r="3" />
        <line x1="19" y1="16" x2="19" y2="19" />
        <line x1="19" y1="19" x2="22" y2="19" />
      </svg>
    ),
  },
];

export default function Navbar({ activeView, onNavigate }) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef(null);

  // Close drawer on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close drawer on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleNav = (id) => {
    onNavigate(id);
    setOpen(false);
  };

  return (
    <nav className={styles.navbar} aria-label="Main navigation">
      {/* Desktop horizontal links */}
      <ul className={styles.desktopNav} role="list">
        {NAV_ITEMS.map(({ id, label, icon }) => (
          <li key={id}>
            <button
              className={`${styles.navItem} ${activeView === id ? styles.active : ''}`}
              onClick={() => handleNav(id)}
              aria-current={activeView === id ? 'page' : undefined}
            >
              <span className={styles.navIcon}>{icon}</span>
              {label}
            </button>
          </li>
        ))}
      </ul>

      {/* Mobile hamburger button */}
      <button
        className={styles.hamburger}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="mobile-drawer"
      >
        <span className={`${styles.bar} ${open ? styles.barOpen1 : ''}`} />
        <span className={`${styles.bar} ${open ? styles.barOpen2 : ''}`} />
        <span className={`${styles.bar} ${open ? styles.barOpen3 : ''}`} />
      </button>

      {/* Overlay */}
      {open && <div className={styles.overlay} aria-hidden="true" onClick={() => setOpen(false)} />}

      {/* Slide-out drawer */}
      <div
        id="mobile-drawer"
        ref={drawerRef}
        className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}
        role="dialog"
        aria-label="Navigation menu"
        aria-hidden={!open}
      >
        <ul className={styles.drawerNav} role="list">
          {NAV_ITEMS.map(({ id, label, icon }) => (
            <li key={id}>
              <button
                className={`${styles.drawerItem} ${activeView === id ? styles.active : ''}`}
                onClick={() => handleNav(id)}
                aria-current={activeView === id ? 'page' : undefined}
                tabIndex={open ? 0 : -1}
              >
                <span className={styles.navIcon}>{icon}</span>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
