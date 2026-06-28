import React, { useState } from 'react';
import AdminAuth from '../AdminAuth/AdminAuth';
import AssetForm from '../AssetForm/AssetForm';
import PauseControl from '../PauseControl/PauseControl';
import EmergencyWithdraw from '../EmergencyWithdraw/EmergencyWithdraw';
import Button from '../Button/Button';
import { AUTH_FAILED } from '../../constants/errors';
import styles from './AdminPage.module.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function AdminPage({ publicKey, onDisconnect }) {
  const [apiKey, setApiKey] = useState(null);
  const [verifying, setVerifying] = useState(false);

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

      <div className={styles.grid}>
        <AssetForm apiKey={apiKey} onAssetChange={handleAssetChange} />
        <PauseControl publicKey={publicKey} />
        <EmergencyWithdraw publicKey={publicKey} />
      </div>
    </div>
  );
}
