/**
 * WebhookLogs — Issue #374
 *
 * Admin page section showing a table of recent webhook delivery attempts
 * across all registered webhooks.
 *
 * Columns: Event Type | Endpoint URL | Status | Response Time | Timestamp | Action
 *
 * Rows are colour-coded:
 *   - green  : 2xx responses (success)
 *   - yellow : 4xx responses (client error)
 *   - red    : 5xx responses or network failure
 *
 * A "Retry" button is shown for failed deliveries and triggers a replay.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { webhookService } from '../../services/webhookService';
import styles from './WebhookLogs.module.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Classify a delivery record into a status tier.
 * @param {Object} d  — delivery record from the backend
 * @returns {'success'|'client-error'|'error'}
 */
function classifyStatus(d) {
  const code = d.statusCode ?? d.status_code ?? 0;
  if (code >= 200 && code < 300) return 'success';
  if (code >= 400 && code < 500) return 'client-error';
  return 'error';
}

function StatusBadge({ delivery }) {
  const tier = classifyStatus(delivery);
  const code = delivery.statusCode ?? delivery.status_code ?? delivery.status ?? '—';
  return (
    <span className={`${styles.badge} ${styles[`badge_${tier}`]}`} aria-label={`Status ${code}`}>
      {code}
    </span>
  );
}

export default function WebhookLogs({ apiKey = '' }) {
  const [webhooks, setWebhooks] = useState([]);
  const [logs, setLogs] = useState([]); // flat list of all deliveries
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(null); // delivery id being retried

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch all registered webhooks
      const { webhooks: whs = [] } = await webhookService.fetchWebhooks(apiKey);
      setWebhooks(whs);

      // 2. Fetch deliveries for each webhook in parallel
      const allDeliveries = await Promise.all(
        whs.map(async (wh) => {
          try {
            const { deliveries = [] } = await webhookService.fetchDeliveries(wh.id, apiKey);
            return deliveries.map((d) => ({
              ...d,
              // Augment each delivery with its parent webhook info
              webhookUrl: wh.url,
              webhookId: wh.id,
            }));
          } catch {
            return [];
          }
        }),
      );

      // 3. Flatten and sort newest first
      const flat = allDeliveries
        .flat()
        .sort((a, b) => new Date(b.timestamp ?? b.createdAt ?? 0) - new Date(a.timestamp ?? a.createdAt ?? 0));

      setLogs(flat);
    } catch (err) {
      setError(err.message || 'Failed to load webhook logs');
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleRetry = useCallback(
    async (delivery) => {
      setRetrying(delivery.id);
      try {
        await webhookService.replayDelivery(delivery.id, apiKey);
        // Refresh logs after successful retry
        await loadLogs();
      } catch (err) {
        setError(err.message || 'Retry failed');
      } finally {
        setRetrying(null);
      }
    },
    [apiKey, loadLogs],
  );

  return (
    <section className={styles.container} aria-label="Webhook delivery logs">
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Webhook Delivery Logs</h2>
          <p className={styles.subtitle}>
            Recent delivery attempts across all registered webhook endpoints
          </p>
        </div>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={loadLogs}
          disabled={loading}
          aria-label="Refresh webhook delivery logs"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {/* Legend */}
      <div className={styles.legend} aria-label="Status code legend">
        <span className={`${styles.legendDot} ${styles.legendDot_success}`} aria-hidden="true" />
        <span>2xx success</span>
        <span className={`${styles.legendDot} ${styles.legendDot_clientError}`} aria-hidden="true" />
        <span>4xx client error</span>
        <span className={`${styles.legendDot} ${styles.legendDot_error}`} aria-hidden="true" />
        <span>5xx / failure</span>
      </div>

      {loading && logs.length === 0 ? (
        <div className={styles.loadingState} aria-live="polite">
          Loading webhook delivery logs…
        </div>
      ) : logs.length === 0 ? (
        <div className={styles.emptyState}>
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
          <p>No delivery records found.</p>
          <p className={styles.emptySubtext}>
            Trigger a webhook event or use the "Test" button in Webhook Management to generate logs.
          </p>
        </div>
      ) : (
        <div className={styles.tableWrapper} role="region" aria-label="Delivery log table">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Event Type</th>
                <th scope="col">Endpoint URL</th>
                <th scope="col">Status</th>
                <th scope="col">Response Time</th>
                <th scope="col">Timestamp</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((d) => {
                const tier = classifyStatus(d);
                const isFailed = tier !== 'success';
                return (
                  <tr
                    key={d.id}
                    className={`${styles.row} ${styles[`row_${tier}`]}`}
                    aria-label={`Delivery ${d.id}: ${tier}`}
                  >
                    {/* Event Type */}
                    <td>
                      <span className={styles.eventType}>
                        {d.eventType ?? d.event_type ?? '—'}
                      </span>
                    </td>

                    {/* Endpoint URL */}
                    <td>
                      <span
                        className={styles.endpointUrl}
                        title={d.webhookUrl ?? d.url ?? '—'}
                      >
                        {(d.webhookUrl ?? d.url ?? '—').replace(/^https?:\/\//, '')}
                      </span>
                    </td>

                    {/* Status code badge */}
                    <td>
                      <StatusBadge delivery={d} />
                    </td>

                    {/* Response time */}
                    <td className={styles.numericCell}>
                      {d.durationMs ?? d.duration_ms != null
                        ? `${d.durationMs ?? d.duration_ms}ms`
                        : '—'}
                    </td>

                    {/* Timestamp */}
                    <td className={styles.timestampCell}>
                      {d.timestamp || d.createdAt
                        ? new Date(d.timestamp ?? d.createdAt).toLocaleString()
                        : '—'}
                    </td>

                    {/* Retry action */}
                    <td>
                      {isFailed ? (
                        <button
                          type="button"
                          className={styles.retryBtn}
                          onClick={() => handleRetry(d)}
                          disabled={retrying === d.id}
                          aria-label={`Retry delivery ${d.id}`}
                        >
                          {retrying === d.id ? 'Retrying…' : 'Retry'}
                        </button>
                      ) : (
                        <span className={styles.noAction} aria-hidden="true">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
