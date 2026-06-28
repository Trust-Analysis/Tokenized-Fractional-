import React, { useState } from 'react';
import Button from '../Button/Button';
import Input from '../Input/Input';
import styles from './AdminAuth.module.css';
import { API_KEY_REQUIRED, AUTH_FAILED_CHECK_KEY } from '../../constants/errors';

export default function AdminAuth({ onAuthenticate }) {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError(API_KEY_REQUIRED);
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onAuthenticate(apiKey.trim());
    } catch {
      setError(AUTH_FAILED_CHECK_KEY);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconWrapper}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h2 className={styles.title}>Admin Access</h2>
        <p className={styles.subtitle}>Enter your API key to manage the marketplace</p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <Input
            id="admin-api-key"
            type="password"
            placeholder="Enter API key"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setError('');
            }}
            autoComplete="off"
          />
          {error && <p className={styles.error}>{error}</p>}
          <Button type="submit" variant="primary" loading={loading}>
            {loading ? 'Authenticating…' : 'Access Admin'}
          </Button>
        </form>
      </div>
    </div>
  );
}
