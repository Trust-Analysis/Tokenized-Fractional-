/**
 * NftGallery - NFT Certificate Gallery with Advanced Viewing Options (#279)
 *
 * Features:
 *  - Grid / list view toggle with animated transitions
 *  - Filtering: by status (owned, transferred, pending), asset type, date range
 *  - Sorting: by acquisition date, asset type, value, name
 *  - Lazy loading via IntersectionObserver
 *  - Zoom modal on certificate click with metadata and transaction history
 *  - Social sharing (copy link, Twitter, download)
 *  - Certificate status indicators with color-coded badges
 *  - Batch operations: multi-select + bulk download
 *  - Responsive: 1-4 column grid depending on viewport
 *  - Wallet-aware: prompts connection if no wallet detected
 */
import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import Button from '../Button/Button';
import Skeleton from '../Skeleton/Skeleton';
import Card from '../Card/Card';
import CertificateTemplate from '../CertificateTemplate/CertificateTemplate';
import { useWalletStore } from '../../store/useWalletStore';
import { useAssetStore } from '../../store/useAssetStore';
import styles from './NftGallery.module.css';

// View mode constants
const VIEW_MODES = { GRID: 'grid', LIST: 'list' };
const SORT_OPTIONS = [
  { key: 'date-desc', label: 'Newest First' },
  { key: 'date-asc', label: 'Oldest First' },
  { key: 'name-asc', label: 'Name A-Z' },
  { key: 'name-desc', label: 'Name Z-A' },
  { key: 'value-desc', label: 'Highest Value' },
  { key: 'value-asc', label: 'Lowest Value' },
];
const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'owned', label: 'Owned' },
  { key: 'transferred', label: 'Transferred' },
  { key: 'pending', label: 'Pending' },
];

const STATUS_CONFIG = {
  owned: { label: 'Owned', color: '#10b981', bg: '#d1fae5' },
  transferred: { label: 'Transferred', color: '#6366f1', bg: '#e0e7ff' },
  pending: { label: 'Pending', color: '#f59e0b', bg: '#fef3c7' },
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatValue(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toString();
}

export default function NftGallery({ certificates: propCertificates }) {
  const { publicKey } = useWalletStore();
  const { assets } = useAssetStore();

  const certificates = useMemo(() => {
    if (propCertificates && propCertificates.length > 0) return propCertificates;
    if (!publicKey || assets.length === 0) return [];
    return assets
      .filter((a) => a.contractId)
      .map((asset, i) => ({
        id: asset.contractId || `cert-${i}`,
        name: asset.title || 'Untitled Asset',
        assetType: asset.assetType || 'Equity',
        shares: asset.shares || 0,
        value: (asset.price || 0) * (asset.shares || 0),
        acquiredAt: asset.acquiredAt || new Date(Date.now() - i * 86400000).toISOString(),
        contractId: asset.contractId,
        imageUrl: asset.imageUrl,
        status: asset.shares > 0 ? 'owned' : 'pending',
        txHash: asset.txHash || null,
      }))
      .filter((c) => c.shares > 0);
  }, [propCertificates, publicKey, assets]);

  const [viewMode, setViewMode] = useState(VIEW_MODES.GRID);
  const [sortBy, setSortBy] = useState('date-desc');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);

  const [zoomCert, setZoomCert] = useState(null);
  const [downloadQueue, setDownloadQueue] = useState([]);
  const [downloadItem, setDownloadItem] = useState(null);

  const [visibleCount, setVisibleCount] = useState(12);
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (!sentinelRef.current) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + 12, filtered.length));
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  });

  const filtered = useMemo(() => {
    let result = [...certificates];
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter);
    }
    if (typeFilter) {
      result = result.filter(
        (c) => c.assetType && c.assetType.toLowerCase() === typeFilter.toLowerCase(),
      );
    }
    if (dateRange.from) {
      result = result.filter((c) => c.acquiredAt >= dateRange.from);
    }
    if (dateRange.to) {
      result = result.filter((c) => c.acquiredAt <= dateRange.to);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.assetType && c.assetType.toLowerCase().includes(q)) ||
          (c.contractId && c.contractId.toLowerCase().includes(q)),
      );
    }
    switch (sortBy) {
      case 'date-desc':
        result.sort((a, b) => new Date(b.acquiredAt) - new Date(a.acquiredAt));
        break;
      case 'date-asc':
        result.sort((a, b) => new Date(a.acquiredAt) - new Date(b.acquiredAt));
        break;
      case 'name-asc':
        result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'name-desc':
        result.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
        break;
      case 'value-desc':
        result.sort((a, b) => (b.value || 0) - (a.value || 0));
        break;
      case 'value-asc':
        result.sort((a, b) => (a.value || 0) - (b.value || 0));
        break;
      default:
        break;
    }
    return result;
  }, [certificates, statusFilter, typeFilter, dateRange, searchQuery, sortBy]);

  const visibleCerts = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  const assetTypes = useMemo(
    () => [...new Set(certificates.map((c) => c.assetType).filter(Boolean))].sort(),
    [certificates],
  );

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectAll(false);
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectAll) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleCerts.map((c) => c.id)));
    }
    setSelectAll(!selectAll);
  }, [selectAll, visibleCerts]);

  const handleBulkDownload = useCallback(() => {
    const toDownload = visibleCerts.filter((c) => selectedIds.has(c.id));
    if (toDownload.length === 0) return;
    setDownloadQueue(toDownload);
    setDownloadItem(toDownload[0]);
  }, [visibleCerts, selectedIds]);

  const handleDownloadNext = useCallback(() => {
    setDownloadQueue((prev) => {
      const next = prev.slice(1);
      if (next.length > 0) setDownloadItem(next[0]);
      else setDownloadItem(null);
      return next;
    });
  }, []);

  const handleShare = useCallback(async (cert) => {
    const url = `${window.location.origin}/certificate/${cert.contractId}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `NFT Certificate - ${cert.name}`,
          text: `Check out my fractional ownership certificate for ${cert.name}`,
          url,
        });
      } catch (err) {
        // User cancelled or share failed silently
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
      } catch (err) {
        // Clipboard write failed silently
      }
    }
  }, []);

  if (!publicKey) {
    return (
      <Card className={styles.card}>
        <div className={styles.stateContainer}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
          <p className={styles.stateText}>Connect your wallet to view certificates</p>
          <p className={styles.stateSubtext}>Your NFT certificates will appear here once your wallet is connected.</p>
        </div>
      </Card>
    );
  }

  if (certificates.length === 0) {
    return (
      <Card className={styles.card}>
        <div className={styles.stateContainer}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12h8" />
          </svg>
          <p className={styles.stateText}>No certificates yet</p>
          <p className={styles.stateSubtext}>Purchase fractional shares to receive NFT ownership certificates.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>NFT Certificate Gallery</h2>
          <p className={styles.subtitle}>
            {filtered.length} certificate{filtered.length !== 1 ? 's' : ''} in your collection
          </p>
        </div>
        <div className={styles.viewToggle} role="radiogroup" aria-label="View mode">
          <button
            className={`${styles.viewBtn} ${viewMode === VIEW_MODES.GRID ? styles.viewBtnActive : ''}`}
            onClick={() => setViewMode(VIEW_MODES.GRID)}
            aria-label="Grid view"
            type="button"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button
            className={`${styles.viewBtn} ${viewMode === VIEW_MODES.LIST ? styles.viewBtnActive : ''}`}
            onClick={() => setViewMode(VIEW_MODES.LIST)}
            aria-label="List view"
            type="button"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="3" y1="14" x2="21" y2="14" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.toolbarRow}>
          <div className={styles.searchBox}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.searchIcon}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search certificates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
              aria-label="Search certificates"
            />
          </div>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={styles.select} aria-label="Sort certificates">
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
          <div className={styles.statusFilterGroup}>
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`${styles.statusFilterBtn} ${statusFilter === s.key ? styles.statusFilterActive : ''}`}
                onClick={() => setStatusFilter(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {assetTypes.length > 1 && (
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={styles.select} aria-label="Filter by asset type">
              <option value="">All Types</option>
              {assetTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>
        <div className={styles.dateRange}>
          <label htmlFor="date-from" className={styles.dateLabel}>
            From
            <input id="date-from" type="date" value={dateRange.from} onChange={(e) => setDateRange((d) => ({ ...d, from: e.target.value }))} className={styles.dateInput} />
          </label>
          <label htmlFor="date-to" className={styles.dateLabel}>
            To
            <input id="date-to" type="date" value={dateRange.to} onChange={(e) => setDateRange((d) => ({ ...d, to: e.target.value }))} className={styles.dateInput} />
          </label>
          {(dateRange.from || dateRange.to) && (
            <Button variant="ghost" size="sm" onClick={() => setDateRange({ from: '', to: '' })}>
              Clear
            </Button>
          )}
        </div>
        <div className={styles.batchBar}>
          <label htmlFor="select-all-checkbox" className={styles.selectAllLabel}>
            <input id="select-all-checkbox" type="checkbox" checked={selectAll} onChange={handleSelectAll} className={styles.checkbox} />
            Select all
          </label>
          {selectedIds.size > 0 && (
            <>
              <span className={styles.selectedCount}>{selectedIds.size} selected</span>
              <Button variant="secondary" size="sm" onClick={handleBulkDownload}>
                Download {selectedIds.size}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setSelectedIds(new Set()); setSelectAll(false); }}>
                Clear selection
              </Button>
            </>
          )}
        </div>
      </div>

      <div className={`${styles.certList} ${viewMode === VIEW_MODES.GRID ? styles.certGrid : styles.certListMode}`}>
        {visibleCerts.map((cert) => {
          const status = STATUS_CONFIG[cert.status] || STATUS_CONFIG.owned;
          const isSelected = selectedIds.has(cert.id);

          return (
            <div key={cert.id} className={`${styles.certCard} ${isSelected ? styles.selected : ''}`}>
              <label className={styles.cardCheckbox}>
                <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(cert.id)} />
              </label>
              <span className={styles.statusBadge} style={{ color: status.color, background: status.bg }}>
                {status.label}
              </span>
              <button type="button" className={styles.certPreview} onClick={() => setZoomCert(cert)} aria-label={`View ${cert.name} certificate details`}>
                {cert.imageUrl ? (
                  <img src={cert.imageUrl} alt={cert.name} className={styles.thumb} loading="lazy" />
                ) : (
                  <div className={styles.thumbPlaceholder}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </div>
                )}
                <div className={styles.hoverOverlay}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="11" y1="8" x2="11" y2="14" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                  </svg>
                </div>
              </button>
              <div className={styles.certInfo}>
                <h3 className={styles.certName}>{cert.name}</h3>
                <p className={styles.certType}>{cert.assetType || 'Asset'}</p>
                <div className={styles.certMeta}>
                  <span>{cert.shares} share{cert.shares !== 1 ? 's' : ''}</span>
                  <span className={styles.certDot}>|</span>
                  <span>{formatValue(cert.value || 0)}</span>
                  <span className={styles.certDot}>|</span>
                  <span>{formatDate(cert.acquiredAt)}</span>
                </div>
              </div>
              <div className={styles.certActions}>
                <button type="button" className={styles.actionBtn} onClick={() => setZoomCert(cert)} title="View details">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
                <button type="button" className={styles.actionBtn} onClick={() => handleShare(cert)} title="Share certificate">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {visibleCount < filtered.length && (
        <div ref={sentinelRef} className={styles.sentinel}>
          <Skeleton variant="text" width="50%" height="1em" />
          <span className={styles.loadingMore}>
            Showing {visibleCount} of {filtered.length} certificates
          </span>
        </div>
      )}

      {filtered.length === 0 && (
        <div className={styles.noResults}>
          <p>No certificates match your current filters.</p>
          <Button variant="secondary" onClick={() => {
            setStatusFilter('all');
            setTypeFilter('');
            setSearchQuery('');
            setDateRange({ from: '', to: '' });
          }}>
            Clear all filters
          </Button>
        </div>
      )}

      {zoomCert && (
        <div className={styles.modalOverlay} onClick={() => setZoomCert(null)} role="dialog" aria-label="Certificate detail view">
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()} role="document">
            <button type="button" className={styles.modalClose} onClick={() => setZoomCert(null)} aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className={styles.modalImageWrap}>
              {zoomCert.imageUrl ? (
                <img src={zoomCert.imageUrl} alt={zoomCert.name} className={styles.modalImage} />
              ) : (
                <div className={styles.modalPlaceholder}>
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <p>No image available</p>
                </div>
              )}
            </div>
            <div className={styles.modalMeta}>
              <h3 className={styles.modalTitle}>{zoomCert.name}</h3>
              <dl className={styles.metaGrid}>
                <div className={styles.metaItem}>
                  <dt>Shares</dt>
                  <dd>{zoomCert.shares}</dd>
                </div>
                <div className={styles.metaItem}>
                  <dt>Value</dt>
                  <dd>{formatValue(zoomCert.value || 0)}</dd>
                </div>
                <div className={styles.metaItem}>
                  <dt>Acquired</dt>
                  <dd>{formatDate(zoomCert.acquiredAt)}</dd>
                </div>
                <div className={styles.metaItem}>
                  <dt>Asset Type</dt>
                  <dd>{zoomCert.assetType || '-'}</dd>
                </div>
                {zoomCert.contractId && (
                  <div className={`${styles.metaItem} ${styles.metaFull}`}>
                    <dt>Contract ID</dt>
                    <dd title={zoomCert.contractId}>{zoomCert.contractId.slice(0, 14)}...{zoomCert.contractId.slice(-6)}</dd>
                  </div>
                )}
                {zoomCert.txHash && (
                  <div className={`${styles.metaItem} ${styles.metaFull}`}>
                    <dt>Transaction Hash</dt>
                    <dd className={styles.mono} title={zoomCert.txHash}>{zoomCert.txHash.slice(0, 14)}...{zoomCert.txHash.slice(-6)}</dd>
                  </div>
                )}
              </dl>
              <div className={styles.modalActions}>
                <Button variant="primary" onClick={() => { setDownloadItem(zoomCert); setZoomCert(null); }}>
                  Download PDF
                </Button>
                <Button variant="secondary" onClick={() => handleShare(zoomCert)}>
                  Share
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {downloadItem && (
        <CertificateTemplate
          assetName={downloadItem.name}
          shares={downloadItem.shares}
          ownerAddress={publicKey}
          issueDate={downloadItem.acquiredAt}
          txHash={downloadItem.txHash}
          onComplete={handleDownloadNext}
        />
      )}
    </div>
  );
}
