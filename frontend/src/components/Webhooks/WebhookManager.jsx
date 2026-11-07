// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import React, { useState, useEffect } from 'react';
import styles from './WebhookManager.module.css';
import { webhookService } from '../../services/webhookService';

export default function WebhookManager({ apiKey = '' }) {
  const [webhooks, setWebhooks] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedWebhook, setSelectedWebhook] = useState(null);
  const [deliveries, setDeliveries] = useState([]);

  // Form state
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState('asset.created,transaction.completed');
  const [encrypted, setEncrypted] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await webhookService.fetchWebhooks(apiKey);
      setWebhooks(data.webhooks || []);
      const stats = await webhookService.fetchAnalytics(apiKey).catch(() => null);
      setAnalytics(stats);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [apiKey]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const eventTypes = events.split(',').map(s => s.trim()).filter(Boolean);
      await webhookService.registerWebhook({ url, description, eventTypes, encrypted }, apiKey);
      setUrl('');
      setDescription('');
      loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this webhook endpoint?')) return;
    try {
      await webhookService.deleteWebhook(id, apiKey);
      if (selectedWebhook?.id === id) {
        setSelectedWebhook(null);
        setDeliveries([]);
      }
      loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTest = async (id) => {
    try {
      await webhookService.testWebhook(id, apiKey);
      alert('Test webhook payload dispatched successfully!');
      if (selectedWebhook?.id === id) {
        loadDeliveries(id);
      }
    } catch (err) {
      alert(`Test failed: ${err.message}`);
    }
  };

  const loadDeliveries = async (id) => {
    try {
      const data = await webhookService.fetchDeliveries(id, apiKey);
      setDeliveries(data.deliveries || []);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSelect = (wh) => {
    setSelectedWebhook(wh);
    loadDeliveries(wh.id);
  };

  const handleReplay = async (deliveryId) => {
    try {
      await webhookService.replayDelivery(deliveryId, apiKey);
      alert('Delivery replayed successfully');
      if (selectedWebhook) {
        loadDeliveries(selectedWebhook.id);
      }
    } catch (err) {
      alert(`Replay failed: ${err.message}`);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Enterprise Webhook Management</h2>
        <button onClick={loadData} className={styles.btnSecondary}>Refresh</button>
      </div>

      {error && <div style={{ color: '#f87171', marginBottom: '1rem' }}>{error}</div>}

      {analytics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className={styles.card}>
            <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Endpoints</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{analytics.totalRegisteredWebhooks}</div>
          </div>
          <div className={styles.card}>
            <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Total Deliveries</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{analytics.totalDeliveries}</div>
          </div>
          <div className={styles.card}>
            <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Success Rate</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#4ade80' }}>{analytics.successRate}%</div>
          </div>
          <div className={styles.card}>
            <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Avg Latency</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{analytics.averageDurationMs}ms</div>
          </div>
        </div>
      )}

      <div className={styles.grid}>
        <div>
          <h3>Registered Webhooks</h3>
          {loading ? (
            <div>Loading webhooks...</div>
          ) : webhooks.length === 0 ? (
            <div>No webhooks registered yet.</div>
          ) : (
            webhooks.map(wh => (
              <div key={wh.id} className={styles.webhookItem}>
                <div>
                  <div style={{ fontWeight: 600 }}>{wh.url}</div>
                  <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{wh.description || 'No description'}</div>
                  <div style={{ marginTop: '0.4rem' }}>
                    {wh.eventTypes.map(ev => (
                      <span key={ev} className={styles.badge}>{ev}</span>
                    ))}
                  </div>
                </div>
                <div className={styles.actions}>
                  <button onClick={() => handleSelect(wh)} className={styles.btnSecondary}>Logs</button>
                  <button onClick={() => handleTest(wh.id)} className={styles.btnSecondary}>Test</button>
                  <button onClick={() => handleDelete(wh.id)} style={{ background: '#991b1b', color: '#fff', border: 'none', padding: '0.5rem', borderRadius: 4, cursor: 'pointer' }}>Delete</button>
                </div>
              </div>
            ))
          )}

          <div className={styles.card} style={{ marginTop: '1.5rem' }}>
            <h3>Register New Webhook</h3>
            <form onSubmit={handleCreate}>
              <div className={styles.formGroup}>
                <label>Target URL</label>
                <input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.yourdomain.com/webhooks" />
              </div>
              <div className={styles.formGroup}>
                <label>Description</label>
                <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Production events receiver" />
              </div>
              <div className={styles.formGroup}>
                <label>Event Subscriptions (comma separated)</label>
                <input type="text" value={events} onChange={e => setEvents(e.target.value)} placeholder="asset.created, transaction.completed" />
              </div>
              <div className={styles.formGroup}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={encrypted} onChange={e => setEncrypted(e.target.checked)} style={{ width: 'auto' }} />
                  Encrypt Payload (AES-256-GCM)
                </label>
              </div>
              <button type="submit" className={styles.btnPrimary}>Register Webhook</button>
            </form>
          </div>
        </div>

        <div>
          <h3>Delivery Logs {selectedWebhook ? `(${selectedWebhook.url})` : ''}</h3>
          {!selectedWebhook ? (
            <div className={styles.card}>Select a webhook from the left to view delivery logs and history.</div>
          ) : deliveries.length === 0 ? (
            <div className={styles.card}>No delivery records found for this webhook.</div>
          ) : (
            <table className={styles.deliveriesTable}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map(d => (
                  <tr key={d.id}>
                    <td>{new Date(d.timestamp).toLocaleTimeString()}</td>
                    <td>{d.eventType}</td>
                    <td className={d.status === 'success' ? styles.statusSuccess : styles.statusFailed}>
                      {d.statusCode || d.status}
                    </td>
                    <td>{d.durationMs}ms</td>
                    <td>
                      <button onClick={() => handleReplay(d.id)} className={styles.btnSecondary} style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                        Replay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
