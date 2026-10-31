import React, { useState, useEffect, useCallback } from 'react';
import Button from '../Button/Button';
import Badge from '../Badge/Badge';
import Card from '../Card/Card';
import styles from './AssetDetailPage.module.css';

// ─── Demo / fallback data ─────────────────────────────────────────────────────

const DEMO_DOCUMENTS = [
  { id: 1, title: 'Property Title Deed', type: 'Legal', date: '2025-03-10', size: '2.4 MB' },
  { id: 2, title: 'Independent Valuation Report', type: 'Valuation', date: '2025-04-22', size: '1.8 MB' },
  { id: 3, title: 'Investment Whitepaper', type: 'Whitepaper', date: '2025-05-01', size: '980 KB' },
  { id: 4, title: 'Due Diligence Summary', type: 'Due Diligence', date: '2025-06-15', size: '3.1 MB' },
  { id: 5, title: 'Insurance Certificate', type: 'Insurance', date: '2025-07-01', size: '540 KB' },
];

const DEMO_EVENTS = [
  { id: 1, date: 'Jul 2025', label: 'Tokenisation completed on Stellar testnet' },
  { id: 2, date: 'Jun 2025', label: 'Independent valuation confirmed at listing price' },
  { id: 3, date: 'Apr 2025', label: 'Due diligence package finalised' },
  { id: 4, date: 'Mar 2025', label: 'Legal title verified and registered' },
  { id: 5, date: 'Jan 2025', label: 'Asset onboarding process initiated' },
];

const DEMO_REVIEWS = [
  {
    id: 1,
    author: 'Alexandra M.',
    initials: 'AM',
    rating: 5,
    date: 'Jul 10, 2025',
    body: 'Outstanding opportunity. The documentation is thorough and the valuation is well-supported. I purchased shares immediately.',
  },
  {
    id: 2,
    author: 'David K.',
    initials: 'DK',
    rating: 4,
    date: 'Jun 28, 2025',
    body: 'Very transparent listing. Would have given 5 stars if there were more photos of the interior.',
  },
  {
    id: 3,
    author: 'Priya S.',
    initials: 'PS',
    rating: 5,
    date: 'Jun 14, 2025',
    body: 'Easy to understand, well priced fractional asset. The Stellar blockchain integration makes everything verifiable.',
  },
];

const DEMO_RELATED = [
  {
    contractId: 'CDEMO0001',
    title: 'Marina Bay Commercial Unit',
    location: 'Singapore',
    assetType: 'Commercial',
    totalValuation: '$1,200,000',
    imageUrl: null,
  },
  {
    contractId: 'CDEMO0002',
    title: 'Kigali Tech Hub Office',
    location: 'Rwanda',
    assetType: 'Office',
    totalValuation: '$850,000',
    imageUrl: null,
  },
  {
    contractId: 'CDEMO0003',
    title: 'Cape Town Waterfront Apartment',
    location: 'South Africa',
    assetType: 'Residential',
    totalValuation: '$620,000',
    imageUrl: null,
  },
];

// Synthetic price-history points for the SVG chart (90-day window)
function generatePriceHistory(basePrice = 100) {
  const points = [];
  let price = basePrice;
  for (let i = 90; i >= 0; i -= 5) {
    price = price + (Math.random() - 0.48) * 3;
    if (price < basePrice * 0.8) price = basePrice * 0.8;
    points.push({ day: 90 - i, price: parseFloat(price.toFixed(2)) });
  }
  return points;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Star rating display */
function StarRating({ value = 4, max = 5 }) {
  return (
    <span className={styles.stars} aria-label={`${value} out of ${max} stars`}>
      {Array.from({ length: max }).map((_, i) => (
        <svg
          key={i}
          className={i < value ? styles.starFilled : styles.starEmpty}
          width="16" height="16" viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <polygon
            points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
            fill={i < value ? '#f59e0b' : 'none'}
            stroke={i < value ? '#f59e0b' : 'currentColor'}
            strokeWidth="1.5"
          />
        </svg>
      ))}
    </span>
  );
}

/** SVG line chart for price history */
function PriceChart({ priceHistory }) {
  const W = 560;
  const H = 160;
  const PAD = { top: 16, right: 16, bottom: 28, left: 44 };

  const prices = priceHistory.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;

  const toX = (day) =>
    PAD.left + ((day / 90) * (W - PAD.left - PAD.right));
  const toY = (price) =>
    PAD.top + ((maxP - price) / range) * (H - PAD.top - PAD.bottom);

  const points = priceHistory.map((p) => `${toX(p.day)},${toY(p.price)}`).join(' ');
  const areaPoints = [
    `${toX(priceHistory[0].day)},${H - PAD.bottom}`,
    ...priceHistory.map((p) => `${toX(p.day)},${toY(p.price)}`),
    `${toX(priceHistory[priceHistory.length - 1].day)},${H - PAD.bottom}`,
  ].join(' ');

  const yLabels = [minP, (minP + maxP) / 2, maxP].map((v) => v.toFixed(0));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={styles.priceChart}
      role="img"
      aria-label="Price history chart"
    >
      {/* Y-axis labels */}
      {[minP, (minP + maxP) / 2, maxP].map((v, i) => {
        const y = toY(v);
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--border-color)" strokeWidth="1" strokeDasharray="4 3" />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{Number(v).toFixed(0)}</text>
          </g>
        );
      })}
      {/* X-axis labels */}
      {[0, 30, 60, 90].map((d) => (
        <text key={d} x={toX(d)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
          {d === 0 ? '90d ago' : d === 90 ? 'Today' : `-${90 - d}d`}
        </text>
      ))}
      {/* Area fill */}
      <polygon points={areaPoints} fill="var(--primary-glow)" opacity="0.5" />
      {/* Line */}
      <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />
      {/* Last price dot */}
      {priceHistory.length > 0 && (
        <circle
          cx={toX(priceHistory[priceHistory.length - 1].day)}
          cy={toY(priceHistory[priceHistory.length - 1].price)}
          r="4"
          fill="var(--primary)"
        />
      )}
    </svg>
  );
}

/** Document type badge colour mapping */
function docTypeBadge(type) {
  const map = { Legal: 'success', Valuation: 'primary', Whitepaper: 'info', 'Due Diligence': 'warning', Insurance: 'default' };
  return map[type] || 'default';
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * AssetDetailPage
 *
 * Renders a rich, tabbed detail view for a single RWA asset.
 *
 * @param {Object}   asset        - Asset metadata object from the API/store
 * @param {Function} onBack       - Called when the user clicks the back button
 * @param {string}   publicKey    - Connected wallet public key (or null)
 * @param {Function} onBuyShares  - Called with qty when user submits a buy
 */
export default function AssetDetailPage({ asset, onBack, publicKey, onBuyShares }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [buyQty, setBuyQty] = useState(1);
  const [shareToast, setShareToast] = useState(false);
  const [avgRating] = useState(4.7);
  const [reviewCount] = useState(34);

  // Build gallery images — use asset images if available, else placeholders
  const images = asset?.images?.length
    ? asset.images
    : [asset?.imageUrl].filter(Boolean);

  // Price history for chart
  const [priceHistory] = useState(() => generatePriceHistory(100));

  // Documents, events, related assets — use asset data or demo fallback
  const documents = asset?.documents?.length ? asset.documents : DEMO_DOCUMENTS;
  const events = asset?.events?.length ? asset.events : DEMO_EVENTS;
  const relatedAssets = asset?.relatedAssets?.length ? asset.relatedAssets : DEMO_RELATED;
  const reviews = asset?.reviews?.length ? asset.reviews : DEMO_REVIEWS;

  // ── SEO meta tags ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!asset) return;
    const prevTitle = document.title;
    const title = `${asset.title || 'Asset'} — RWA Marketplace`;
    const description = asset.description
      ? asset.description.slice(0, 160)
      : `Invest in fractional shares of ${asset.title} on the Stellar blockchain.`;

    document.title = title;

    const setMeta = (name, content, prop = false) => {
      const attr = prop ? 'property' : 'name';
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
        el.dataset.assetDetailManaged = '1';
      }
      el.setAttribute('content', content);
    };

    setMeta('description', description);
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    if (asset.imageUrl) setMeta('og:image', asset.imageUrl, true);
    setMeta('og:type', 'website', true);

    return () => {
      document.title = prevTitle;
      document.querySelectorAll('meta[data-asset-detail-managed]').forEach((el) => el.remove());
    };
  }, [asset]);

  // ── Share functionality ──────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    const shareData = {
      title: asset?.title || 'RWA Asset',
      text: `Check out this tokenised asset: ${asset?.title || 'RWA Asset'}`,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (_) { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(window.location.href);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2500);
    }
  }, [asset]);

  if (!asset) return null;

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'documents', label: 'Documents' },
    { id: 'history', label: 'History' },
    { id: 'related', label: 'Related Assets' },
  ];

  return (
    <div className={styles.page}>
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className={styles.topBar}>
        <button onClick={onBack} className={styles.backBtn} aria-label="Back to marketplace">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className={styles.topActions}>
          <button onClick={handleShare} className={styles.shareBtn} aria-label="Share this asset">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            Share
          </button>
          {shareToast && (
            <span className={styles.shareToast} role="status">Link copied!</span>
          )}
        </div>
      </div>

      {/* ── Hero: gallery + headline ──────────────────────────────────────── */}
      <div className={styles.hero}>
        {/* Gallery */}
        <div className={styles.gallery}>
          <div className={styles.mainImage}>
            {images.length > 0 ? (
              <img
                src={images[galleryIndex]}
                alt={`${asset.title} — image ${galleryIndex + 1}`}
                className={styles.heroImg}
                loading="lazy"
              />
            ) : (
              <div className={styles.imagePlaceholder} aria-label="No image available">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className={styles.thumbnailStrip}>
              {images.map((src, i) => (
                <button
                  key={i}
                  className={`${styles.thumbnail} ${i === galleryIndex ? styles.thumbnailActive : ''}`}
                  onClick={() => setGalleryIndex(i)}
                  aria-label={`View image ${i + 1}`}
                >
                  <img src={src} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Headline info */}
        <div className={styles.heroInfo}>
          <div className={styles.heroBadgeRow}>
            {asset.assetType && <Badge variant="primary">{asset.assetType}</Badge>}
          </div>
          <h1 className={styles.heroTitle}>{asset.title || 'Untitled Asset'}</h1>
          {asset.location && (
            <p className={styles.heroLocation}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
              </svg>
              {asset.location}
            </p>
          )}
          {/* Social proof summary */}
          <div className={styles.ratingRow}>
            <StarRating value={Math.round(avgRating)} />
            <span className={styles.ratingValue}>{avgRating.toFixed(1)}</span>
            <span className={styles.ratingCount}>({reviewCount} reviews)</span>
          </div>
          {/* Key metrics */}
          <div className={styles.metricGrid}>
            {asset.totalValuation && (
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Valuation</span>
                <span className={styles.metricValue}>{asset.totalValuation}</span>
              </div>
            )}
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Share Price</span>
              <span className={styles.metricValue}>10 XLM</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Shares Available</span>
              <span className={styles.metricValue}>100</span>
            </div>
          </div>
          {/* Contract ID */}
          {asset.contractId && (
            <div className={styles.contractRow}>
              <span className={styles.contractLabel}>Contract</span>
              <code className={styles.contractId} title={asset.contractId}>
                {asset.contractId.slice(0, 12)}…{asset.contractId.slice(-8)}
              </code>
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <nav className={styles.tabs} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── Tab panels ───────────────────────────────────────────────────── */}
      <div className={styles.tabPanel} role="tabpanel">

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className={styles.overviewGrid}>
            <div>
              <h2 className={styles.sectionHeading}>About This Asset</h2>
              <p className={styles.description}>{asset.description || 'No description provided.'}</p>

              <h2 className={styles.sectionHeading} style={{ marginTop: '1.5rem' }}>User Reviews</h2>
              <div className={styles.reviewList}>
                {reviews.map((r) => (
                  <div key={r.id} className={styles.reviewCard}>
                    <div className={styles.reviewHeader}>
                      <span className={styles.reviewAvatar}>{r.initials}</span>
                      <div>
                        <span className={styles.reviewAuthor}>{r.author}</span>
                        <span className={styles.reviewDate}>{r.date}</span>
                      </div>
                      <StarRating value={r.rating} />
                    </div>
                    <p className={styles.reviewBody}>{r.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Documents */}
        {activeTab === 'documents' && (
          <div>
            <h2 className={styles.sectionHeading}>Legal &amp; Due Diligence Documents</h2>
            <div className={styles.docList}>
              {documents.map((doc) => (
                <div key={doc.id} className={styles.docRow}>
                  <div className={styles.docIcon}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div className={styles.docMeta}>
                    <span className={styles.docTitle}>{doc.title}</span>
                    <span className={styles.docDetail}>{doc.date} · {doc.size}</span>
                  </div>
                  <Badge variant={docTypeBadge(doc.type)}>{doc.type}</Badge>
                  <a
                    href="#"
                    className={styles.docDownload}
                    onClick={(e) => e.preventDefault()}
                    aria-label={`Download ${doc.title}`}
                    title="Download"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* History */}
        {activeTab === 'history' && (
          <div>
            <h2 className={styles.sectionHeading}>Price History (90 Days)</h2>
            <div className={styles.chartContainer}>
              <PriceChart priceHistory={priceHistory} />
            </div>

            <h2 className={styles.sectionHeading} style={{ marginTop: '2rem' }}>Key Events</h2>
            <div className={styles.timeline}>
              {events.map((ev, idx) => (
                <div key={ev.id} className={styles.timelineItem}>
                  <div className={styles.timelineDot} />
                  {idx < events.length - 1 && <div className={styles.timelineLine} />}
                  <div className={styles.timelineContent}>
                    <span className={styles.timelineDate}>{ev.date}</span>
                    <span className={styles.timelineLabel}>{ev.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Related Assets */}
        {activeTab === 'related' && (
          <div>
            <h2 className={styles.sectionHeading}>Related Assets</h2>
            <div className={styles.relatedGrid}>
              {relatedAssets.map((ra) => (
                <Card key={ra.contractId} hoverable className={styles.relatedCard}>
                  <div className={styles.relatedImage}>
                    {ra.imageUrl ? (
                      <img src={ra.imageUrl} alt={ra.title} loading="lazy" />
                    ) : (
                      <div className={styles.relatedPlaceholder}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className={styles.relatedBody}>
                    {ra.assetType && <span className={styles.relatedType}>{ra.assetType}</span>}
                    <h3 className={styles.relatedTitle}>{ra.title}</h3>
                    <p className={styles.relatedLocation}>{ra.location}</p>
                    {ra.totalValuation && (
                      <p className={styles.relatedValuation}>{ra.totalValuation}</p>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Buy shares ───────────────────────────────────────────────────── */}
      {publicKey && (
        <Card className={styles.buyCard}>
          <h3 className={styles.buyHeading}>Buy Fractional Shares</h3>
          <p className={styles.buySubtext}>Each share represents a fractional ownership unit of this asset.</p>
          <div className={styles.buyRow}>
            <input
              type="number"
              min="1"
              value={buyQty}
              onChange={(e) => setBuyQty(Math.max(1, Number(e.target.value)))}
              className={styles.buyInput}
              aria-label="Number of shares to buy"
            />
            <Button
              variant="primary"
              onClick={() => onBuyShares && onBuyShares(buyQty)}
            >
              Buy {buyQty} Share{buyQty !== 1 ? 's' : ''}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
