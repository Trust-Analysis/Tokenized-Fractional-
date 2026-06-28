import React, { useState, useEffect, useCallback } from 'react';
import { rpc, TransactionBuilder, Networks, Contract, nativeToScVal } from '@stellar/stellar-sdk';
import Card from '../Card/Card';
import Skeleton from '../Skeleton/Skeleton';
import Button from '../Button/Button';
import Spinner from '../Spinner/Spinner';
import CertificateTemplate from '../CertificateTemplate/CertificateTemplate';
import { useWalletStore } from '../../store/useWalletStore';
import { useAssetStore } from '../../store/useAssetStore';
import { FAILED_TO_FETCH_PORTFOLIO_ASSET, FAILED_TO_LOAD_PORTFOLIO } from '../../constants/errors';
import styles from './PortfolioPage.module.css';

const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

const server = new rpc.Server(RPC_URL);

export default function PortfolioPage() {
  const { publicKey } = useWalletStore();
  const { assets } = useAssetStore();

  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [totalValue, setTotalValue] = useState(0);
  const [certItem, setCertItem] = useState(null);

  const fetchPortfolio = useCallback(async () => {
    if (!publicKey || assets.length === 0) {
      setHoldings([]);
      setTotalValue(0);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const account = await server.getAccount(publicKey);

      const rows = await Promise.all(
        assets.map(async (asset) => {
          if (!asset.contractId || asset.contractId.length < 50) {
            return null;
          }

          try {
            const contract = new Contract(asset.contractId);
            const scValAddress = nativeToScVal(publicKey, { type: 'address' });

            const simulate = async (method, args = []) => {
              let tx = new TransactionBuilder(account, {
                fee: '100',
                networkPassphrase: NETWORK_PASSPHRASE,
              });
              tx = tx.addOperation(contract.call(method, ...args)).setTimeout(30).build();
              const res = await server.simulateTransaction(tx);
              if (!res.result) return null;
              return res.result.retval;
            };

            const [sharesVal, priceVal] = await Promise.all([
              simulate('get_shares', [scValAddress]),
              simulate('get_price'),
            ]);

            const shares = sharesVal ? Number(sharesVal.u32()) : 0;
            const price = priceVal ? Number(priceVal.i128()) : 0;
            const value = shares * price;

            return {
              contractId: asset.contractId,
              title: asset.title || 'Untitled Asset',
              imageUrl: asset.imageUrl,
              shares,
              price,
              value,
            };
          } catch {
            return {
              contractId: asset.contractId,
              title: asset.title || 'Untitled Asset',
              imageUrl: asset.imageUrl,
              shares: 0,
              price: 0,
              value: 0,
               error: FAILED_TO_FETCH_PORTFOLIO_ASSET,
            };
          }
        })
      );

      const valid = rows.filter(Boolean);
      setHoldings(valid);
      setTotalValue(valid.reduce((sum, h) => sum + h.value, 0));
    } catch (err) {
      console.error('Error fetching portfolio:', err);
      setError(FAILED_TO_LOAD_PORTFOLIO);
    } finally {
      setLoading(false);
    }
  }, [publicKey, assets]);

  const handleDownloadCertificate = useCallback((item) => {
    if (!publicKey) return;
    setCertItem({
      contractId: item.contractId,
      title: item.title,
      shares: item.shares,
      address: publicKey,
      date: new Date().toISOString(),
    });
  }, [publicKey]);

  const handleCertificateComplete = useCallback(() => {
    setCertItem(null);
  }, []);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  if (!publicKey) {
    return (
      <Card className={styles.card}>
        <div className={styles.stateContainer}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <p className={styles.stateText}>Connect your wallet to view portfolio</p>
        </div>
      </Card>
    );
  }

  if (assets.length === 0) {
    return (
      <Card className={styles.card}>
        <div className={styles.stateContainer}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
            <polyline points="13 2 13 9 20 9"></polyline>
          </svg>
          <p className={styles.stateText}>No assets available</p>
          <p className={styles.stateSubtext}>There are no assets to display in your portfolio.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Portfolio</h2>
          <p className={styles.subtitle}>Your fractional asset holdings across all markets</p>
        </div>
        <Button onClick={fetchPortfolio} loading={loading} variant="primary">
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className={styles.error}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          {error}
        </div>
      )}

      {/* Summary bar */}
      <Card className={styles.summaryCard}>
        <div className={styles.summaryRow}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Assets Held</span>
            <span className={styles.summaryValue}>{holdings.filter(h => h.shares > 0).length}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Total Shares</span>
            <span className={styles.summaryValue}>{holdings.reduce((s, h) => s + h.shares, 0)}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Total Value</span>
            <span className={styles.summaryValueAccent}>{totalValue.toLocaleString()}</span>
          </div>
        </div>
      </Card>

      {/* Holdings table */}
      <div className={styles.tableContainer}>
        {loading && holdings.length === 0 ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className={styles.rowCard}>
              <div className={styles.skeletonRow}>
                <Skeleton variant="rect" width="40px" height="40px" style={{ borderRadius: 'var(--radius-sm)' }} />
                <div className={styles.skeletonBody}>
                  <Skeleton variant="text" width="60%" height="1em" style={{ marginBottom: 'var(--spacing-xs)' }} />
                  <Skeleton variant="text" width="30%" height="0.8em" />
                </div>
                <Skeleton variant="text" width="80px" height="1em" />
                <Skeleton variant="text" width="80px" height="1em" />
                <Skeleton variant="text" width="100px" height="1em" />
                <Skeleton variant="text" width="60px" height="1em" />
              </div>
            </Card>
          ))
        ) : (
          <>
            <div className={`${styles.tableHeader} ${styles.tableHeaderWithAction}`}>
              <span className={styles.colAsset}>Asset</span>
              <span className={styles.colShares}>Shares</span>
              <span className={styles.colPrice}>Price</span>
              <span className={styles.colValue}>Total Value</span>
              <span className={styles.colAction}>Certificate</span>
            </div>

            {holdings.map((item) => (
              <Card key={item.contractId} className={styles.rowCard}>
                <div className={styles.row}>
                  <div className={styles.assetInfo}>
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.title} className={styles.assetThumb} loading="lazy" />
                    ) : (
                      <div className={styles.thumbPlaceholder}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                          <circle cx="8.5" cy="8.5" r="1.5"></circle>
                          <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                      </div>
                    )}
                    <div>
                      <span className={styles.assetName}>{item.title}</span>
                      <span className={styles.contractId} title={item.contractId}>
                        {item.contractId.slice(0, 8)}…
                      </span>
                    </div>
                  </div>
                  <span className={styles.colShares}>{item.shares}</span>
                  <span className={styles.colPrice}>{item.price.toLocaleString()}</span>
                  <span className={`${styles.colValue} ${item.shares > 0 ? styles.valuePositive : ''}`}>
                    {item.value.toLocaleString()}
                  </span>
                  <span className={styles.colAction}>
                    {item.shares > 0 && (
                      <Button
                        onClick={() => handleDownloadCertificate(item)}
                        variant="secondary"
                        size="sm"
                        className={styles.certButton}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="7 10 12 15 17 10"></polyline>
                          <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        PDF
                      </Button>
                    )}
                  </span>
                </div>
              </Card>
            ))}
          </>
        )}

        {!loading && holdings.length === 0 && (
          <Card className={styles.card}>
            <div className={styles.stateContainer}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                <polyline points="13 2 13 9 20 9"></polyline>
              </svg>
              <p className={styles.stateText}>No holdings found</p>
              <p className={styles.stateSubtext}>You don't own any shares yet. Browse assets in the marketplace.</p>
            </div>
          </Card>
        )}
      </div>

      {certItem && (
        <CertificateTemplate
          assetName={certItem.title}
          shares={certItem.shares}
          ownerAddress={certItem.address}
          issueDate={certItem.date}
          onComplete={handleCertificateComplete}
        />
      )}
    </div>
  );
}
