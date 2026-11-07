import React, { useState, useEffect, useCallback } from 'react';
import Button from '../Button/Button';
import Input from '../Input/Input';
import Card from '../Card/Card';
import { useToastStore } from '../../store/useToastStore';
import styles from './PriceAlert.module.css';

const STORAGE_KEY = 'rwa_price_alerts';

function loadAlerts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveAlerts(alerts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
}

const STROOP = 10_000_000;

function formatPrice(stroops) {
  return (stroops / STROOP).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
}

export default function PriceAlert({ contractId, assetTitle, currentPrice }) {
  const [alerts, setAlerts] = useState([]);
  const [targetPrice, setTargetPrice] = useState('');
  const [alertType, setAlertType] = useState('below');
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    setAlerts(loadAlerts());
  }, []);

  const activeAlerts = alerts.filter((a) => a.contractId === contractId && a.active !== false);

  const handleAddAlert = useCallback(() => {
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) {
      addToast({ message: 'Enter a valid target price', type: 'error' });
      return;
    }

    const priceInStroops = Math.round(price * STROOP);
    const existing = loadAlerts();
    const newAlert = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      contractId,
      assetTitle,
      targetPrice: priceInStroops,
      type: alertType,
      createdAt: new Date().toISOString(),
      active: true,
      triggered: false,
    };
    const updated = [...existing, newAlert];
    saveAlerts(updated);
    setAlerts(updated);
    setTargetPrice('');
    addToast({ message: `Alert set for ${alertType === 'below' ? 'below' : 'above'} ${price} XLM`, type: 'success' });
  }, [targetPrice, alertType, contractId, assetTitle, addToast]);

  const handleRemoveAlert = useCallback((alertId) => {
    const existing = loadAlerts();
    const updated = existing.filter((a) => a.id !== alertId);
    saveAlerts(updated);
    setAlerts(updated);
  }, []);

  const isBelow = alertType === 'below';
  const [triggered, setTriggered] = useState(new Set());

  useEffect(() => {
    if (currentPrice == null || activeAlerts.length === 0) return;

    for (const alert of activeAlerts) {
      if (triggered.has(alert.id) || alert.triggered) continue;
      const fired = isBelow
        ? currentPrice <= alert.targetPrice
        : currentPrice >= alert.targetPrice;
      if (fired) {
        setTriggered((prev) => new Set([...prev, alert.id]));
        addToast({
          message: `Price alert: ${assetTitle} is now ${isBelow ? 'below' : 'above'} ${formatPrice(alert.targetPrice)} XLM (current: ${formatPrice(currentPrice)} XLM)`,
          type: 'info',
          duration: 10000,
        });
        const existing = loadAlerts();
        const updated = existing.map((a) =>
          a.id === alert.id ? { ...a, triggered: true } : a
        );
        saveAlerts(updated);
      }
    }
  }, [currentPrice, activeAlerts, assetTitle, isBelow, addToast, triggered]);

  if (!contractId) return null;

  return (
    <Card className={styles.container}>
      <h3 className={styles.title}>Price Alerts</h3>

      {activeAlerts.length > 0 && (
        <div className={styles.activeAlerts}>
          {activeAlerts.map((alert) => (
            <div key={alert.id} className={`${styles.alertItem} ${alert.triggered ? styles.alertTriggered : ''}`}>
              <span className={styles.alertInfo}>
                {alert.triggered ? 'Triggered: ' : 'Alert when '}
                {alert.type === 'below' ? 'below' : 'above'} {formatPrice(alert.targetPrice)} XLM
              </span>
              <button
                className={styles.removeBtn}
                onClick={() => handleRemoveAlert(alert.id)}
                aria-label="Remove alert"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.form}>
        <div className={styles.typeRow}>
          <button
            className={`${styles.typeBtn} ${isBelow ? styles.typeActive : ''}`}
            onClick={() => setAlertType('below')}
          >
            Below
          </button>
          <button
            className={`${styles.typeBtn} ${!isBelow ? styles.typeActive : ''}`}
            onClick={() => setAlertType('above')}
          >
            Above
          </button>
        </div>
        <div className={styles.inputRow}>
          <Input
            type="number"
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            placeholder="Target price (XLM)"
            min="0"
            step="0.01"
            className={styles.priceInput}
          />
          <Button onClick={handleAddAlert} variant="secondary" size="sm">
            Set Alert
          </Button>
        </div>
      </div>
    </Card>
  );
}
