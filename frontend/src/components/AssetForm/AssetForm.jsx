// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * AssetForm — Create / Update / Delete asset form with real-time validation.
 *
 * Issue #299: Advanced Form Validation with Real-time Feedback
 * Now uses useFormValidation hook for:
 *   - Real-time debounced validation as users type
 *   - Clear, actionable error messages per field
 *   - Visual indicators (aria-invalid, error styling)
 *   - Custom validators: contractId format, URL, numeric, required
 *   - Prevents submission with invalid data
 *   - Success feedback on valid submission
 */

import React, { useState, useMemo } from 'react';
import Button from '../Button/Button';
import Input from '../Input/Input';
import Alert from '../Alert/Alert';
import { useFormValidation, validators } from '../../hooks/useFormValidation';
import styles from './AssetForm.module.css';
import {
  SERVER_ERROR,
  FAILED_TO_SAVE_ASSET,
  ENTER_CONTRACT_ID_TO_DELETE,
  FAILED_TO_DELETE_ASSET,
} from '../../constants/errors';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const INITIAL_VALUES = {
  contractId: '',
  title: '',
  location: '',
  description: '',
  assetType: '',
  imageUrl: '',
  totalValuation: '',
};

const VALIDATION_RULES = {
  contractId: [
    validators.required('Contract ID is required'),
    validators.contractId('Must be a valid Soroban contract ID (starts with C, 56 chars)'),
  ],
  title: [
    validators.required('Title is required'),
    validators.minLength(3, 'Title must be at least 3 characters'),
    validators.maxLength(100, 'Title must be at most 100 characters'),
  ],
  location: [
    validators.required('Location is required'),
    validators.minLength(2, 'Location must be at least 2 characters'),
  ],
  description: [
    validators.required('Description is required'),
    validators.minLength(10, 'Description must be at least 10 characters'),
    validators.maxLength(2000, 'Description must be at most 2000 characters'),
  ],
  assetType: [
    validators.required('Asset type is required'),
  ],
  imageUrl: [
    (value) => {
      if (!value) return null;
      return validators.url('Please enter a valid image URL')(value);
    },
  ],
  totalValuation: [
    (value) => {
      if (!value) return null;
      const num = Number(value.replace(/[$,]/g, ''));
      if (isNaN(num)) return 'Must be a valid number';
      if (num <= 0) return 'Must be a positive value';
      return null;
    },
  ],
};

function AssetForm({ apiKey, onAssetChange }) {
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState('');

  const handleValidSubmit = async (values) => {
    setServerError('');
    setSuccess('');
    try {
      const res = await fetch(`${API_URL}/api/v1/rwa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          ...values,
          documents: [],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || SERVER_ERROR(res.status));
      }

      const data = await res.json();
      setSuccess(`Asset "${data.title}" created/updated successfully!`);
      reset();
      if (onAssetChange) onAssetChange();
    } catch (err) {
      setServerError(err.message || FAILED_TO_SAVE_ASSET);
    }
  };

  const {
    values,
    errors,
    touched,
    isValid,
    isSubmitting,
    submitSuccess,
    handleChange,
    handleBlur,
    handleSubmit,
    reset,
    getFieldProps,
  } = useFormValidation({
    initialValues: INITIAL_VALUES,
    validationRules: VALIDATION_RULES,
    onSubmit: handleValidSubmit,
  });

  const handleDelete = async () => {
    if (!values.contractId.trim()) {
      setServerError(ENTER_CONTRACT_ID_TO_DELETE);
      return;
    }
    if (!confirm(`Delete asset "${values.contractId.slice(0, 12)}\u2026"? This cannot be undone.`)) return;

    setServerError('');
    setSuccess('');
    try {
      const res = await fetch(`${API_URL}/api/v1/rwa/${values.contractId}`, {
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
      setServerError(err.message || FAILED_TO_DELETE_ASSET);
    }
  };

  // Helper: check if a field has an error and has been touched
  const hasError = (name) => touched[name] && errors[name];
  const fieldState = (name) => {
    if (hasError(name)) return styles.fieldError;
    if (touched[name] && !errors[name] && values[name]) return styles.fieldValid;
    return '';
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>Create / Update Asset</h3>

      {serverError && <Alert variant="error">{serverError}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        <div className={styles.row}>
          <div className={`${styles.field} ${fieldState('contractId')}`}>
            <label className={styles.label} htmlFor="af-contractId">
              Contract ID *
            </label>
            <Input
              id="af-contractId"
              placeholder="C\u2026 (56+ chars)"
              {...getFieldProps('contractId')}
            />
            {hasError('contractId') && (
              <span className={styles.fieldErrorText} id="contractId-error" role="alert">
                {errors.contractId}
              </span>
            )}
            {!hasError('contractId') && touched.contractId && values.contractId && (
              <span className={styles.fieldHelp}>\u2713 Valid contract ID format</span>
            )}
          </div>
          <div className={`${styles.field} ${fieldState('assetType')}`}>
            <label className={styles.label} htmlFor="af-assetType">
              Asset Type *
            </label>
            <Input
              id="af-assetType"
              placeholder="Real Estate, Agriculture\u2026"
              {...getFieldProps('assetType')}
            />
            {hasError('assetType') && (
              <span className={styles.fieldErrorText} id="assetType-error" role="alert">
                {errors.assetType}
              </span>
            )}
          </div>
        </div>

        <div className={`${styles.field} ${fieldState('title')}`}>
          <label className={styles.label} htmlFor="af-title">
            Title *
          </label>
          <Input
            id="af-title"
            placeholder="Asset name"
            {...getFieldProps('title')}
          />
          {hasError('title') && (
            <span className={styles.fieldErrorText} id="title-error" role="alert">
              {errors.title}
            </span>
          )}
        </div>

        <div className={`${styles.field} ${fieldState('location')}`}>
          <label className={styles.label} htmlFor="af-location">
            Location *
          </label>
          <Input
            id="af-location"
            placeholder="City, Country"
            {...getFieldProps('location')}
          />
          {hasError('location') && (
            <span className={styles.fieldErrorText} id="location-error" role="alert">
              {errors.location}
            </span>
          )}
        </div>

        <div className={`${styles.field} ${fieldState('description')}`}>
          <label className={styles.label} htmlFor="af-description">
            Description *
          </label>
          <Input
            id="af-description"
            placeholder="Describe the asset (min 10 chars)"
            {...getFieldProps('description')}
          />
          {hasError('description') && (
            <span className={styles.fieldErrorText} id="description-error" role="alert">
              {errors.description}
            </span>
          )}
          {!hasError('description') && (
            <span className={styles.fieldHelp}>
              {values.description.length}/2000 characters
            </span>
          )}
        </div>

        <div className={styles.row}>
          <div className={`${styles.field} ${fieldState('imageUrl')}`}>
            <label className={styles.label} htmlFor="af-imageUrl">
              Image URL
            </label>
            <Input
              id="af-imageUrl"
              placeholder="https://\u2026"
              {...getFieldProps('imageUrl')}
            />
            {hasError('imageUrl') && (
              <span className={styles.fieldErrorText} id="imageUrl-error" role="alert">
                {errors.imageUrl}
              </span>
            )}
          </div>
          <div className={`${styles.field} ${fieldState('totalValuation')}`}>
            <label className={styles.label} htmlFor="af-valuation">
              Total Valuation
            </label>
            <Input
              id="af-valuation"
              placeholder="$1,000,000"
              {...getFieldProps('totalValuation')}
            />
            {hasError('totalValuation') && (
              <span className={styles.fieldErrorText} id="totalValuation-error" role="alert">
                {errors.totalValuation}
              </span>
            )}
          </div>
        </div>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={isSubmitting} disabled={!isValid}>
            {isSubmitting ? 'Saving\u2026' : 'Save Asset'}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleDelete}
            disabled={isSubmitting}
          >
            Delete by Contract ID
          </Button>
        </div>
      </form>
    </div>
  );
}

export default React.memo(AssetForm);
