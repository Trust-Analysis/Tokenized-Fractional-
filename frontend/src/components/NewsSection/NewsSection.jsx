import React, { useState, useEffect } from 'react';
import Card from '../Card/Card';
import Skeleton from '../Skeleton/Skeleton';
import styles from './NewsSection.module.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const PLACEHOLDER_NEWS = [
  {
    id: '1',
    title: 'Welcome to RWA Marketplace',
    summary: 'We are excited to launch our platform for tokenized real-world assets on the Stellar network.',
    date: new Date().toISOString(),
    link: 'https://github.com/Trust-Analysis/Tokenized-Fractional-',
  },
  {
    id: '2',
    title: 'New Asset Listings Available',
    summary: 'Browse newly listed real estate and other assets in the marketplace.',
    date: new Date(Date.now() - 86400000).toISOString(),
    link: '#',
  },
];

export default function NewsSection() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchNews() {
      try {
        const res = await fetch(`${API_URL}/api/v1/news`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setNews(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) {
          setNews(PLACEHOLDER_NEWS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchNews();
    return () => { cancelled = true; };
  }, []);

  const formatDate = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>News & Updates</h2>
      <div className={styles.grid}>
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className={styles.card}>
              <Skeleton variant="text" width="70%" height="1.1em" style={{ marginBottom: 'var(--spacing-xs)' }} />
              <Skeleton variant="text" lines={2} style={{ marginBottom: 'var(--spacing-sm)' }} />
              <Skeleton variant="text" width="30%" height="0.8em" />
            </Card>
          ))
        ) : news.length === 0 ? (
          <Card className={styles.card}>
            <div className={styles.emptyState}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <p className={styles.emptyText}>No news available</p>
            </div>
          </Card>
        ) : (
          news.map((item) => (
            <Card key={item.id} className={styles.card}>
              <h3 className={styles.newsTitle}>{item.title}</h3>
              <p className={styles.newsSummary}>{item.summary}</p>
              <div className={styles.newsFooter}>
                <span className={styles.newsDate}>{formatDate(item.date)}</span>
                {item.link && item.link !== '#' && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.newsLink}
                  >
                    Read more
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </section>
  );
}
