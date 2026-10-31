import React, { useState, useEffect, useCallback } from 'react';
import Card from '../Card/Card';
import Button from '../Button/Button';
import Badge from '../Badge/Badge';
import Skeleton from '../Skeleton/Skeleton';
import CertificateTemplate from '../CertificateTemplate/CertificateTemplate';
import Modal from '../Modal/Modal';
import { useWalletStore } from '../../store/useWalletStore';
import { useAssetStore } from '../../store/useAssetStore';
import { useTranslation } from 'react-i18next';
import { useToastStore } from '../../store/useToastStore';
import styles from './ProfilePage.module.css';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const HORIZON_LIMIT = 10;

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function shortHash(hash) {
  return hash.slice(0, 6) + '...' + hash.slice(-4);
}

function explorerLink(hash) {
  return 'https://stellar.expert/explorer/testnet/tx/' + hash;
}

export default function ProfilePage() {
  const { t } = useTranslation();
  const { publicKey, shares, isConnecting, connect, disconnect } = useWalletStore();
  const { assets } = useAssetStore();
  const addToast = useToastStore((s) => s.addToast);

  const [activeTab, setActiveTab] = useState('overview');
  const [copied, setCopied] = useState(false);
  const [txs, setTxs] = useState([]);
  const [txLoading, setTxLoading] = useState(false);
  const [certItem, setCertItem] = useState(null);
  const [nftView, setNftView] = useState('grid');
  const [showPreferences, setShowPreferences] = useState(false);
  const [txFilter, setTxFilter] = useState('all');

  const fetchTransactions = useCallback(async () => {
    if (!publicKey) return;
    setTxLoading(true);
    try {
      const url = HORIZON_URL + '/accounts/' + publicKey + '/transactions?order=desc&limit=20&include_failed=true';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Horizon error: ' + res.status);
      const data = await res.json();
      const records = data._embedded?.records ?? [];
      setTxs(records.slice(0, HORIZON_LIMIT));
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    } finally {
      setTxLoading(false);
    }
  }, [publicKey]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const handleCopyAddress = () => {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey).then(function () {
      setCopied(true);
      addToast({ message: t('profile.copied'), type: 'success' });
      setTimeout(function () { setCopied(false); }, 2000);
    }).catch(function () {
      addToast({ message: t('profile.copyFailed'), type: 'error' });
    });
  };

  const totalSharesValue = assets.reduce(function (s, a) { return s + (a.shares || 0); }, 0) + (shares || 0);
  const filteredTxs = txFilter === 'all' ? txs : txs.filter(function (tx) {
    return tx.successful === (txFilter === 'success');
  });

  if (!publicKey) {
    return (
      <div className={styles.container}>
        <Card className={styles.connectPrompt}>
          <div className={styles.connectInner}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className={styles.connectIcon}>
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>
            </svg>
            <h2 className={styles.connectTitle}>Your Profile Dashboard</h2>
            <p className={styles.connectSub}>
              Connect your Freighter wallet to view portfolio, manage preferences, download NFT certificates, and track your transaction history.
            </p>
            <Button onClick={connect} variant="primary" loading={isConnecting}>
              {isConnecting ? t('wallet.connecting') : t('wallet.connect')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.profileHeader}>
        <div className={styles.profileAvatar}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>
          </svg>
        </div>
        <div className={styles.profileInfo}>
          <h2 className={styles.profileName}>My Dashboard</h2>
          <div className={styles.walletRow}>
            <code className={styles.walletAddress}>{publicKey}</code>
            <button
              className={styles.copyBtn + (copied ? ' ' + styles.copied : '')}
              onClick={handleCopyAddress} title="Copy wallet address" aria-label="Copy wallet address"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                {copied
                  ? <polyline points="20 6 9 17 4 12"></polyline>
                  : <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></>
                }
              </svg>
            </button>
          </div>
        </div>
        <div className={styles.profileActions}>
          <Button onClick={function () { setShowPreferences(true); }} variant="secondary" size="sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            Preferences
          </Button>
          <Button onClick={disconnect} variant="danger" size="sm">Disconnect</Button>
        </div>
      </div>

      <nav className={styles.tabNav}>
        {[
          { id: 'overview', label: t('profile.overview'), icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
          { id: 'nfts', label: t('profile.certificates'), icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
          { id: 'activity', label: t('profile.activity'), icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
          { id: 'support', label: t('profile.support'), icon: 'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z' },
        ].map(function (tab) {
          return (
            <button key={tab.id} className={styles.tab + (activeTab === tab.id ? ' ' + styles.tabActive : '')} onClick={function () { setActiveTab(tab.id); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={tab.icon}></path></svg>
              {tab.label}
            </button>
          );
        })}
      </nav>

      {activeTab === 'overview' && (
        <div className={styles.tabContent}>
          <div className={styles.summaryGrid}>
            <Card className={styles.summaryCard}>
              <div className={styles.summaryIcon}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg></div>
              <div className={styles.summaryBody}>
                <span className={styles.summaryValue}>${totalSharesValue.toLocaleString()}</span>
                <span className={styles.summaryLabel}>Portfolio Value</span>
                <div className={styles.summaryTrend}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
                  <span>+2.4% this week</span>
                </div>
              </div>
            </Card>
            <Card className={styles.summaryCard}>
              <div className={styles.summaryIcon}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg></div>
              <div className={styles.summaryBody}>
                <span className={styles.summaryValue}>{assets.length}</span>
                <span className={styles.summaryLabel}>Assets Held</span>
              </div>
            </Card>
            <Card className={styles.summaryCard}>
              <div className={styles.summaryIcon}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></div>
              <div className={styles.summaryBody}>
                <span className={styles.summaryValue}>{totalSharesValue.toLocaleString()}</span>
                <span className={styles.summaryLabel}>Total Shares</span>
              </div>
            </Card>
          </div>

          <Card className={styles.allocationCard}>
            <h3 className={styles.sectionTitle}>Asset Allocation</h3>
            <div className={styles.allocationBar}>
              {assets.length > 0 ? assets.slice(0, 5).map(function (asset, i) {
                return <div key={asset.contractId || i} className={styles.allocationSegment} style={{ flex: asset.shares || 1, background: ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--error)', '#8b5cf6'][i % 5], minWidth: '4px' }} title={(asset.title || 'Asset ' + (i + 1)) + ': ' + (asset.shares || 0) + ' shares'} />;
              }) : <div className={styles.allocationEmpty}>No assets to display</div>}
            </div>
            <div className={styles.allocationLegend}>
              {assets.length > 0 ? assets.slice(0, 5).map(function (asset, i) {
                return <div key={asset.contractId || i} className={styles.legendItem}>
                  <span className={styles.legendDot} style={{ background: ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--error)', '#8b5cf6'][i % 5] }} />
                  <span className={styles.legendLabel}>{asset.title || 'Asset ' + (i + 1)}</span>
                </div>;
              }) : <span className={styles.legendEmpty}>No assets allocated yet</span>}
            </div>
          </Card>

          <Card className={styles.txCard}>
            <div className={styles.txHeader}>
              <h3 className={styles.sectionTitle}>Recent Transactions</h3>
              <div className={styles.txFilters}>
                {['all', 'success', 'failed'].map(function (f) {
                  return <button key={f} className={styles.txFilterBtn + (txFilter === f ? ' ' + styles.txFilterActive : '')} onClick={function () { setTxFilter(f); }}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>;
                })}
              </div>
            </div>
            <div className={styles.txList}>
              {txLoading ? Array.from({ length: 3 }).map(function (_, i) {
                return <div key={i} className={styles.txRow}><Skeleton variant="text" width="100px" height="1em" /><Skeleton variant="text" width="80px" height="1em" /><Skeleton variant="text" width="60px" height="1em" /></div>;
              }) : filteredTxs.length > 0 ? filteredTxs.map(function (tx) {
                return <div key={tx.id} className={styles.txRow}>
                  <a href={explorerLink(tx.hash)} target="_blank" rel="noreferrer noopener" className={styles.txHash} title={tx.hash}>{shortHash(tx.hash)}</a>
                  <span className={styles.txDate}>{formatDate(tx.created_at)}</span>
                  <span className={styles.txOps}>{tx.operation_count ?? tx.operations_count ?? '--'}</span>
                  <Badge variant={tx.successful ? 'success' : 'danger'}>{tx.successful ? t('profile.success') : t('profile.failed')}</Badge>
                </div>;
              }) : <div className={styles.txEmpty}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg><p>No transactions found</p></div>}
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'nfts' && (
        <div className={styles.tabContent}>
          <div className={styles.nftHeader}>
            <h3 className={styles.sectionTitle}>Certificate Gallery</h3>
            <div className={styles.nftViewToggle}>
              <button className={styles.viewBtn + (nftView === 'grid' ? ' ' + styles.viewActive : '')} onClick={function () { setNftView('grid'); }} title="Grid view">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
              </button>
              <button className={styles.viewBtn + (nftView === 'list' ? ' ' + styles.viewActive : '')} onClick={function () { setNftView('list'); }} title="List view">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              </button>
            </div>
          </div>
          {assets.length > 0 ? (
            <div className={nftView === 'grid' ? styles.nftGrid : styles.nftList}>
              {assets.map(function (asset, i) {
                return <Card key={asset.contractId || i} className={styles.nftCard} hoverable>
                  {asset.imageUrl ? <img src={asset.imageUrl} alt={asset.title} className={styles.nftImage} />
                    : <div className={styles.nftImagePlaceholder}><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></div>}
                  <div className={styles.nftInfo}><h4 className={styles.nftName}>{asset.title || 'Asset #' + (i + 1)}</h4><p className={styles.nftShares}>Ownership Certificate</p></div>
                  <div className={styles.nftActions}>
                    <Button onClick={function () { setCertItem({ contractId: asset.contractId, title: asset.title || t('profile.assetCert'), shares: asset.shares || 0, address: publicKey, date: new Date().toISOString() }); }} variant="secondary" size="sm">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                      Certificate
                    </Button>
                  </div>
                </Card>;
              })}
            </div>
          ) : (
            <Card><div className={styles.nftEmpty}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
              <p>No certificates available yet</p>
              <p className={styles.nftEmptySub}>Purchase shares to generate NFT certificates.</p>
            </div></Card>
          )}
        </div>
      )}

      {activeTab === 'activity' && (
        <div className={styles.tabContent}>
          <Card>
            <h3 className={styles.sectionTitle}>Activity Timeline</h3>
            <div className={styles.timeline}>
              {[
                { action: t('profile.walletConnected'), timestamp: Date.now() - 86400000 * 2, icon: 'wallet' },
                { action: t('profile.sharesPurchased'), detail: t('profile.sharesPurchasedDetail'), timestamp: Date.now() - 86400000 * 5, icon: 'shares' },
                { action: t('profile.portfolioViewed'), timestamp: Date.now() - 86400000 * 7, icon: 'view' },
                { action: t('profile.certDownloaded'), timestamp: Date.now() - 86400000 * 10, icon: 'cert' },
                { action: t('profile.txCompleted'), detail: t('profile.paymentReceived'), timestamp: Date.now() - 86400000 * 14, icon: 'tx' },
              ].map(function (item, i) {
                return <div key={i} className={styles.timelineItem}>
                  <div className={styles.timelineDot}>
                    {item.icon === 'wallet' && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h4v-4z"></path></svg>}
                    {item.icon === 'shares' && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>}
                    {item.icon === 'cert' && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>}
                    {item.icon === 'tx' && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>}
                    {item.icon === 'view' && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>}
                  </div>
                  <div className={styles.timelineContent}>
                    <p className={styles.timelineAction}>{item.action}</p>
                    {item.detail && <p className={styles.timelineDetail}>{item.detail}</p>}
                    <span className={styles.timelineDate}>{formatDate(new Date(item.timestamp).toISOString())}</span>
                  </div>
                </div>;
              })}
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'support' && (
        <div className={styles.tabContent}>
          <div className={styles.supportGrid}>
            {[
              { title: t('profile.helpCenter'), desc: t('profile.helpCenterDesc'), icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
              { title: t('profile.contactSupport'), desc: t('profile.contactSupportDesc'), icon: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22,6 12,13 2,6' },
              { title: t('profile.githubIssues'), desc: t('profile.githubIssuesDesc'), icon: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22' },
              { title: t('profile.documentation'), desc: t('profile.documentationDesc'), icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
            ].map(function (card, i) {
              return <Card key={i} className={styles.supportCard} hoverable>
                <div className={styles.supportIcon}><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={card.icon}></path></svg></div>
                <h4>{card.title}</h4>
                <p>{card.desc}</p>
              </Card>;
            })}
          </div>
        </div>
      )}

      {certItem && (
        <CertificateTemplate
          assetName={certItem.title} shares={certItem.shares}
          ownerAddress={certItem.address} issueDate={certItem.date}
          onComplete={function () { setCertItem(null); }}
        />
      )}

      {showPreferences && (
        <Modal title="Preferences" onClose={function () { setShowPreferences(false); }}>
          <div className={styles.prefsForm}>
            <div className={styles.prefGroup}>
              <label className={styles.prefLabel}>Display Currency</label>
              <select className={styles.prefSelect} defaultValue="usd">
                <option value="usd">USD ($)</option><option value="eur">EUR (€)</option><option value="gbp">GBP (£)</option>
              </select>
            </div>
            <div className={styles.prefGroup}>
              <label className={styles.prefLabel}>Notifications</label>
              <label className={styles.prefToggle}><input type="checkbox" defaultChecked /><span>Email notifications for transactions</span></label>
              <label className={styles.prefToggle}><input type="checkbox" defaultChecked /><span>Push notifications for price alerts</span></label>
            </div>
            <div className={styles.prefActions}>
              <Button variant="primary" onClick={function () { addToast({ message: t('profile.prefsSaved'), type: 'success' }); setShowPreferences(false); }}>Save</Button>
              <Button variant="secondary" onClick={function () { setShowPreferences(false); }}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
