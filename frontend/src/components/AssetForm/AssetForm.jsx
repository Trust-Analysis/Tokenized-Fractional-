import React, { useState, useEffect } from 'react';
import Button from '../Button/Button';
import Input from '../Input/Input';
import Alert from '../Alert/Alert';
import styles from './AssetForm.module.css';
import {
  MISSING_REQUIRED_FIELDS,
  SERVER_ERROR,
  FAILED_TO_SAVE_ASSET,
  ENTER_CONTRACT_ID_TO_DELETE,
  FAILED_TO_DELETE_ASSET,
} from '../../constants/errors';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function AssetForm({ apiKey, onAssetChange }) {
  const [form, setForm] = useState({
    contractId: '',
    title: '',
    location: '',
    description: '',
    assetType: '',
    imageUrl: '',
    totalValuation: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const required = ['contractId', 'title', 'location', 'description', 'assetType'];
    const missing = required.filter((f) => !form[f].trim());
    if (missing.length > 0) {
      setError(MISSING_REQUIRED_FIELDS(missing));
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`${API_URL}/api/v1/rwa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          ...form,
          documents: [],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || SERVER_ERROR(res.status));
      }

      const data = await res.json();
      setSuccess(`Asset "${data.title}" created/updated successfully!`);
      setForm({
        contractId: '',
        title: '',
        location: '',
        description: '',
        assetType: '',
        imageUrl: '',
        totalValuation: '',
      });
      if (onAssetChange) onAssetChange();
    } catch (err) {
      setError(err.message || FAILED_TO_SAVE_ASSET);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (contractId) => {
    if (!contractId.trim()) {
      setError(ENTER_CONTRACT_ID_TO_DELETE);
      return;
    }
    if (!confirm(`Delete asset "${contractId.slice(0, 12)}…"? This cannot be undone.`)) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`${API_URL}/api/v1/rwa/${contractId}`, {
        method: 'DELETE',
        headers: { 'x-api-key': apiKey },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || SERVER_ERROR(res.status));
      }
      setSuccess('Asset deleted successfully');
      if (onAssetChange) onAssetChange();
    } catch (err) {
      setError(err.message || FAILED_TO_DELETE_ASSET);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>Create / Update Asset</h3>

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="af-contractId">Contract ID *</label>
            <Input
              id="af-contractId"
              placeholder="C… (56+ chars)"
              value={form.contractId}
              onChange={handleChange('contractId')}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="af-assetType">Asset Type *</label>
            <Input
              id="af-assetType"
              placeholder="Real Estate, Agriculture…"
              value={form.assetType}
              onChange={handleChange('assetType')}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="af-title">Title *</label>
          <Input
            id="af-title"
            placeholder="Asset name"
            value={form.title}
            onChange={handleChange('title')}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="af-location">Location *</label>
          <Input
            id="af-location"
            placeholder="City, Country"
            value={form.location}
            onChange={handleChange('location')}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="af-description">Description *</label>
          <Input
            id="af-description"
            placeholder="Describe the asset"
            value={form.description}
            onChange={handleChange('description')}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="af-imageUrl">Image URL</label>
            <Input
              id="af-imageUrl"
              placeholder="https://…"
              value={form.imageUrl}
              onChange={handleChange('imageUrl')}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="af-valuation">Total Valuation</label>
            <Input
              id="af-valuation"
              placeholder="$1,000,000"
              value={form.totalValuation}
              onChange={handleChange('totalValuation')}
            />
          </div>
        </div>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={loading}>
            {loading ? 'Saving…' : 'Save Asset'}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => handleDelete(form.contractId)}
            disabled={loading}
          >
            Delete by Contract ID
          </Button>
        </div>
      </form>
    </div>
  );
}
