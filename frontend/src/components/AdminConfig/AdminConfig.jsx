/* Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors */
/* SPDX-License-Identifier: MIT */

import React, { useState, useEffect, useCallback } from 'react';
import Button from '../Button/Button';
import styles from './AdminConfig.module.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Validation rules
const validationRules = {
  pricePerShare: {
    validate: (v) => typeof v === 'number' && v > 0 && v <= 1000000000,
    message: 'Must be a positive number up to 1 billion',
    min: 1,
    max: 1000000000,
  },
  totalShares: {
    validate: (v) => typeof v === 'number' && v > 0 && v <= 1000000000,
    message: 'Must be a positive number up to 1 billion',
    min: 1,
    max: 1000000000,
  },
  maxSharesPerUser: {
    validate: (v) => typeof v === 'number' && v >= 0 && v <= 1000000000,
    message: 'Must be 0 (unlimited) or up to 1 billion',
    min: 0,
    max: 1000000000,
  },
  dividendInterval: {
    validate: (v) => typeof v === 'number' && v >= 60 && v <= 31536000,
    message: 'Must be between 60 seconds and 1 year',
    min: 60,
    max: 31536000,
  },
  dividendAmountPerShare: {
    validate: (v) => typeof v === 'number' && v >= 0 && v <= 1000000000,
    message: 'Must be between 0 and 1 billion',
    min: 0,
    max: 1000000000,
  },
  minPurchaseAmount: {
    validate: (v) => typeof v === 'number' && v >= 1,
    message: 'Must be at least 1',
    min: 1,
  },
  maxPurchaseAmount: {
    validate: (v) => typeof v === 'number' && v >= 1,
    message: 'Must be at least 1',
    min: 1,
  },
  platformFeePercent: {
    validate: (v) => typeof v === 'number' && v >= 0 && v <= 10000,
    message: 'Must be between 0 and 100% (0-10000 basis points)',
    min: 0,
    max: 10000,
  },
  royaltyPercent: {
    validate: (v) => typeof v === 'number' && v >= 0 && v <= 5000,
    message: 'Must be between 0 and 50% (0-5000 basis points)',
    min: 0,
    max: 5000,
  },
  flashLoanMinHoldTime: {
    validate: (v) => typeof v === 'number' && v >= 0 && v <= 86400,
    message: 'Must be between 0 and 86400 seconds',
    min: 0,
    max: 86400,
  },
};

function ConfigSection({ title, children }) {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.sectionContent}>{children}</div>
    </div>
  );
}

function ConfigField({ label, name, value, type = 'number', onChange, error, description }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={name}>
        {label}
      </label>
      {description && <p className={styles.description}>{description}</p>}
      {type === 'boolean' ? (
        <label className={styles.toggle}>
          <input
            type="checkbox"
            name={name}
            checked={value}
            onChange={(e) => onChange(name, e.target.checked)}
          />
          <span className={styles.toggleSlider}></span>
          <span className={styles.toggleLabel}>{value ? 'Enabled' : 'Disabled'}</span>
        </label>
      ) : (
        <input
          type="number"
          id={name}
          name={name}
          value={value}
          onChange={(e) => onChange(name, Number(e.target.value))}
          className={`${styles.input} ${error ? styles.inputError : ''}`}
          min={validationRules[name]?.min}
          max={validationRules[name]?.max}
        />
      )}
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}

export default function AdminConfig({ apiKey }) {
  const [config, setConfig] = useState(null);
  const [originalConfig, setOriginalConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [showAudit, setShowAudit] = useState(false);

  // Fetch configuration
  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/admin/config`, {
        headers: { 'x-api-key': apiKey },
      });
      if (!res.ok) throw new Error('Failed to fetch config');
      const data = await res.json();
      setConfig(data.config);
      setOriginalConfig({ ...data.config });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  // Fetch audit log
  const fetchAuditLog = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/config/audit`, {
        headers: { 'x-api-key': apiKey },
      });
      if (!res.ok) throw new Error('Failed to fetch audit log');
      const data = await res.json();
      setAuditLog(data.entries);
    } catch (err) {
      console.error('Audit log fetch failed:', err);
    }
  }, [apiKey]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (showAudit) {
      fetchAuditLog();
    }
  }, [showAudit, fetchAuditLog]);

  // Handle field change with validation
  const handleChange = useCallback((name, value) => {
    setConfig((prev) => ({ ...prev, [name]: value }));

    // Validate
    const rule = validationRules[name];
    if (rule && !rule.validate(value)) {
      setErrors((prev) => ({ ...prev, [name]: rule.message }));
    } else {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }, []);

  // Save configuration
  const handleSave = useCallback(async () => {
    // Validate all
    const newErrors = {};
    for (const [key, value] of Object.entries(config)) {
      if (validationRules[key] && !validationRules[key].validate(value)) {
        newErrors[key] = validationRules[key].message;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setMessage({ type: 'error', text: 'Please fix validation errors' });
      return;
    }

    // Check min/max purchase relationship
    if (config.minPurchaseAmount > config.maxPurchaseAmount) {
      setErrors({
        maxPurchaseAmount: 'Must be greater than minimum purchase',
      });
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${API_URL}/api/admin/config`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.errors?.[0]?.message || 'Failed to save config');
      }

      const data = await res.json();
      setConfig(data.config);
      setOriginalConfig({ ...data.config });
      setMessage({ type: 'success', text: 'Configuration saved successfully' });
      setErrors({});
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }, [config, apiKey]);

  // Reset to defaults
  const handleReset = useCallback(async () => {
    if (!window.confirm('Are you sure you want to reset to default configuration?')) {
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${API_URL}/api/admin/config/reset`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
      });

      if (!res.ok) throw new Error('Failed to reset config');

      const data = await res.json();
      setConfig(data.config);
      setOriginalConfig({ ...data.config });
      setMessage({ type: 'success', text: 'Configuration reset to defaults' });
      setErrors({});
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }, [apiKey]);

  // Export configuration
  const handleExport = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/config/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ includeAudit: true }),
      });

      if (!res.ok) throw new Error('Failed to export config');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `admin-config-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ type: 'success', text: 'Configuration exported' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  }, [apiKey]);

  // Check for unsaved changes
  const hasChanges = config && originalConfig && JSON.stringify(config) !== JSON.stringify(originalConfig);

  if (loading) {
    return <div className={styles.loading}>Loading configuration...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Admin Configuration</h2>
          <p className={styles.subtitle}>Manage platform settings and contract parameters</p>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setShowAudit(!showAudit)}>
            {showAudit ? 'Hide Audit Log' : 'Show Audit Log'}
          </Button>
          <Button variant="secondary" onClick={handleExport}>
            Export
          </Button>
          <Button variant="danger" onClick={handleReset}>
            Reset to Defaults
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving || !hasChanges}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {message && (
        <div className={`${styles.message} ${styles[message.type]}`}>
          {message.text}
        </div>
      )}

      <div className={styles.grid}>
        {/* Contract Parameters */}
        <ConfigSection title="Contract Parameters">
          <ConfigField
            label="Price per Share"
            name="pricePerShare"
            value={config.pricePerShare}
            onChange={handleChange}
            error={errors.pricePerShare}
            description="Price in smallest token unit (e.g., 1000000 = 1 unit)"
          />
          <ConfigField
            label="Total Shares"
            name="totalShares"
            value={config.totalShares}
            onChange={handleChange}
            error={errors.totalShares}
          />
          <ConfigField
            label="Max Shares per User"
            name="maxSharesPerUser"
            value={config.maxSharesPerUser}
            onChange={handleChange}
            error={errors.maxSharesPerUser}
            description="0 = unlimited"
          />
        </ConfigSection>

        {/* Dividend Settings */}
        <ConfigSection title="Dividend Settings">
          <ConfigField
            label="Dividend Interval (seconds)"
            name="dividendInterval"
            value={config.dividendInterval}
            onChange={handleChange}
            error={errors.dividendInterval}
            description="Minimum 60 seconds"
          />
          <ConfigField
            label="Dividend Amount per Share"
            name="dividendAmountPerShare"
            value={config.dividendAmountPerShare}
            onChange={handleChange}
            error={errors.dividendAmountPerShare}
          />
        </ConfigSection>

        {/* Purchase Limits */}
        <ConfigSection title="Purchase Limits">
          <ConfigField
            label="Minimum Purchase Amount"
            name="minPurchaseAmount"
            value={config.minPurchaseAmount}
            onChange={handleChange}
            error={errors.minPurchaseAmount}
          />
          <ConfigField
            label="Maximum Purchase Amount"
            name="maxPurchaseAmount"
            value={config.maxPurchaseAmount}
            onChange={handleChange}
            error={errors.maxPurchaseAmount}
          />
        </ConfigSection>

        {/* Fee Settings */}
        <ConfigSection title="Fee Settings">
          <ConfigField
            label="Platform Fee (basis points)"
            name="platformFeePercent"
            value={config.platformFeePercent}
            onChange={handleChange}
            error={errors.platformFeePercent}
            description="250 = 2.5%"
          />
          <ConfigField
            label="Royalty (basis points)"
            name="royaltyPercent"
            value={config.royaltyPercent}
            onChange={handleChange}
            error={errors.royaltyPercent}
            description="100 = 1%"
          />
        </ConfigSection>

        {/* Security Settings */}
        <ConfigSection title="Security Settings">
          <ConfigField
            label="Allow Whitelist Only"
            name="allowWhitelistOnly"
            type="boolean"
            value={config.allowWhitelistOnly}
            onChange={handleChange}
          />
          <ConfigField
            label="Enable Flash Loan Protection"
            name="enableFlashLoanProtection"
            type="boolean"
            value={config.enableFlashLoanProtection}
            onChange={handleChange}
          />
          <ConfigField
            label="Flash Loan Min Hold Time (seconds)"
            name="flashLoanMinHoldTime"
            value={config.flashLoanMinHoldTime}
            onChange={handleChange}
            error={errors.flashLoanMinHoldTime}
          />
        </ConfigSection>

        {/* Pause Controls */}
        <ConfigSection title="Pause Controls">
          <ConfigField
            label="Buy Paused"
            name="buyPaused"
            type="boolean"
            value={config.buyPaused}
            onChange={handleChange}
          />
          <ConfigField
            label="Sell Paused"
            name="sellPaused"
            type="boolean"
            value={config.sellPaused}
            onChange={handleChange}
          />
          <ConfigField
            label="Transfer Paused"
            name="transferPaused"
            type="boolean"
            value={config.transferPaused}
            onChange={handleChange}
          />
        </ConfigSection>
      </div>

      {/* Audit Log */}
      {showAudit && (
        <div className={styles.auditSection}>
          <h3 className={styles.sectionTitle}>Audit Log</h3>
          {auditLog.length === 0 ? (
            <p className={styles.noData}>No audit entries yet</p>
          ) : (
            <div className={styles.auditList}>
              {auditLog.map((entry) => (
                <div key={entry.id} className={styles.auditEntry}>
                  <span className={styles.auditAction}>{entry.action}</span>
                  <span className={styles.auditTime}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                  <span className={styles.auditAdmin}>{entry.adminKey}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
