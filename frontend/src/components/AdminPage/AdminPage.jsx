/**
 * AdminPage — Issue #374 addition:
 * Adds a "Webhook Logs" tab that renders the WebhookLogs viewer showing
 * delivery history, status codes, response times, and a Retry button.
 */
import React, { useState } from 'react';
import AdminAuth from '../AdminAuth/AdminAuth';
import AssetForm from '../AssetForm/AssetForm';
import PauseControl from '../PauseControl/PauseControl';
import EmergencyWithdraw from '../EmergencyWithdraw/EmergencyWithdraw';
import PaymentTokenManager from '../PaymentTokenManager/PaymentTokenManager';
import AdminConfig from '../AdminConfig/AdminConfig';
import WebhookLogs from '../WebhookLogs/WebhookLogs';
import Button from '../Button/Button';
import { AUTH_FAILED } from '../../constants/errors';
import styles from './AdminPage.module.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const ADMIN_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'webhook-logs', label: 'Webhook Logs' },
];

export default function AdminPage({ publicKey, onDisconnect }) {
  const [apiKey, setApiKey] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  const handleAuthenticate = async (key) => {
    setVerifying(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/verify`, {
        headers: { 'x-api-key': key },
      });
      if (!res.ok) throw new Error(AUTH_FAILED);
      setApiKey(key);
    } catch {
      throw new Error(AUTH_FAILED);
    } finally {
      setVerifying(false);
    }
  };

  const handleAssetChange = () => {
    // Assets have changed — any side effects needed after create/update/delete
  };

  if (!apiKey) {
    return <AdminAuth onAuthenticate={handleAuthenticate} />;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Admin Dashboard</h2>
          <p className={styles.subtitle}>Manage assets, pause operations, and handle emergencies</p>
        </div>
        <Button variant="danger" onClick={onDisconnect}>
          Lock Admin
        </Button>
      </div>

      {/* Tab navigation for admin sub-sections (Issue #374) */}
      <nav className={styles.tabs} aria-label="Admin sections">
        {ADMIN_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Dashboard panel */}
      {activeTab === 'dashboard' && (
        <div className={styles.grid}>
          <AdminConfig apiKey={apiKey} />
          <AssetForm apiKey={apiKey} onAssetChange={handleAssetChange} />
          <PauseControl publicKey={publicKey} />
          <EmergencyWithdraw publicKey={publicKey} />
          <PaymentTokenManager publicKey={publicKey} />
        </div>
      )}

      {/* Webhook delivery logs panel (Issue #374) */}
      {activeTab === 'webhook-logs' && (
        <WebhookLogs apiKey={apiKey} />
      )}
    </div>
  );
}
