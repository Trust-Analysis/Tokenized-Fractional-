import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Footer.module.css';

/**
 * Footer — global site footer, added by issue #797.
 *
 * The repository had no site-wide footer, so there was nowhere to link the
 * public status page from. This component exists for that link: when the app
 * itself is down or degraded, users need one place that is *independent of the
 * app* to check whether the problem is known.
 *
 * The status page is a separate static deployment (see `status/README.md`), so
 * its URL is configuration, not a constant. Set `VITE_STATUS_URL` at build time;
 * the placeholder below is deliberately obvious rather than a plausible-looking
 * URL that would silently point at nothing.
 *
 * @param {object}  props
 * @param {string}  [props.statusUrl] - override the build-time status page URL
 */
export const DEFAULT_STATUS_URL = 'https://status.example.com';

export default function Footer({ statusUrl }) {
  const { t } = useTranslation();
  const href = statusUrl || import.meta.env?.VITE_STATUS_URL || DEFAULT_STATUS_URL;

  return (
    <footer className={styles.footer}>
      <a
        className={styles.link}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        data-testid="status-page-link"
      >
        <span className={styles.dot} aria-hidden="true" />
        {t('footer.status')}
      </a>
    </footer>
  );
}
