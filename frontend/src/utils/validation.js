// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/utils/validation.js — Issue #322: Frontend Form Validation
 *
 * Provides comprehensive validation utilities for all admin forms
 * with detailed error messages and field-level validation.
 */

/**
 * Validation rules for admin configuration fields
 */
export const configValidationRules = {
  pricePerShare: {
    type: 'number',
    required: true,
    min: 1,
    max: 1000000000,
    messages: {
      required: 'Price per share is required',
      min: 'Price must be at least 1',
      max: 'Price cannot exceed 1 billion',
      type: 'Price must be a valid number',
    },
  },
  totalShares: {
    type: 'number',
    required: true,
    min: 1,
    max: 1000000000,
    messages: {
      required: 'Total shares is required',
      min: 'Total shares must be at least 1',
      max: 'Total shares cannot exceed 1 billion',
      type: 'Total shares must be a valid number',
    },
  },
  maxSharesPerUser: {
    type: 'number',
    required: true,
    min: 0,
    max: 1000000000,
    messages: {
      required: 'Max shares per user is required',
      min: 'Max shares per user cannot be negative',
      max: 'Max shares per user cannot exceed 1 billion',
      type: 'Max shares per user must be a valid number',
    },
  },
  dividendInterval: {
    type: 'number',
    required: true,
    min: 60,
    max: 31536000,
    messages: {
      required: 'Dividend interval is required',
      min: 'Dividend interval must be at least 60 seconds',
      max: 'Dividend interval cannot exceed 1 year (31536000 seconds)',
      type: 'Dividend interval must be a valid number',
    },
  },
  dividendAmountPerShare: {
    type: 'number',
    required: true,
    min: 0,
    max: 1000000000,
    messages: {
      required: 'Dividend amount per share is required',
      min: 'Dividend amount cannot be negative',
      max: 'Dividend amount cannot exceed 1 billion',
      type: 'Dividend amount must be a valid number',
    },
  },
  minPurchaseAmount: {
    type: 'number',
    required: true,
    min: 1,
    messages: {
      required: 'Minimum purchase amount is required',
      min: 'Minimum purchase amount must be at least 1',
      type: 'Minimum purchase amount must be a valid number',
    },
  },
  maxPurchaseAmount: {
    type: 'number',
    required: true,
    min: 1,
    messages: {
      required: 'Maximum purchase amount is required',
      min: 'Maximum purchase amount must be at least 1',
      type: 'Maximum purchase amount must be a valid number',
    },
  },
  platformFeePercent: {
    type: 'number',
    required: true,
    min: 0,
    max: 10000,
    messages: {
      required: 'Platform fee is required',
      min: 'Platform fee cannot be negative',
      max: 'Platform fee cannot exceed 100% (10000 basis points)',
      type: 'Platform fee must be a valid number',
    },
  },
  royaltyPercent: {
    type: 'number',
    required: true,
    min: 0,
    max: 5000,
    messages: {
      required: 'Royalty percent is required',
      min: 'Royalty percent cannot be negative',
      max: 'Royalty percent cannot exceed 50% (5000 basis points)',
      type: 'Royalty percent must be a valid number',
    },
  },
  flashLoanMinHoldTime: {
    type: 'number',
    required: true,
    min: 0,
    max: 86400,
    messages: {
      required: 'Flash loan min hold time is required',
      min: 'Flash loan min hold time cannot be negative',
      max: 'Flash loan min hold time cannot exceed 24 hours (86400 seconds)',
      type: 'Flash loan min hold time must be a valid number',
    },
  },
  allowWhitelistOnly: {
    type: 'boolean',
    messages: {
      type: 'Allow whitelist only must be a boolean',
    },
  },
  enableFlashLoanProtection: {
    type: 'boolean',
    messages: {
      type: 'Enable flash loan protection must be a boolean',
    },
  },
  buyPaused: {
    type: 'boolean',
    messages: {
      type: 'Buy paused must be a boolean',
    },
  },
  sellPaused: {
    type: 'boolean',
    messages: {
      type: 'Sell paused must be a boolean',
    },
  },
  transferPaused: {
    type: 'boolean',
    messages: {
      type: 'Transfer paused must be a boolean',
    },
  },
};

/**
 * Validate a single field value
 * @param {string} fieldName - The field name
 * @param {*} value - The value to validate
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateField(fieldName, value) {
  const rule = configValidationRules[fieldName];
  if (!rule) {
    return { valid: true, error: null };
  }

  // Type check
  if (rule.type === 'number' && typeof value !== 'number') {
    return { valid: false, error: rule.messages.type };
  }

  if (rule.type === 'boolean' && typeof value !== 'boolean') {
    return { valid: false, error: rule.messages.type };
  }

  // Required check
  if (rule.required && (value === null || value === undefined || value === '')) {
    return { valid: false, error: rule.messages.required };
  }

  // Min/max validation
  if (rule.type === 'number') {
    if (rule.min !== undefined && value < rule.min) {
      return { valid: false, error: rule.messages.min };
    }
    if (rule.max !== undefined && value > rule.max) {
      return { valid: false, error: rule.messages.max };
    }
  }

  return { valid: true, error: null };
}

/**
 * Validate all fields in a configuration object
 * @param {Object} config - The configuration object
 * @returns {{ valid: boolean, errors: Object }}
 */
export function validateConfig(config) {
  const errors = {};
  let valid = true;

  for (const [field, value] of Object.entries(config)) {
    const result = validateField(field, value);
    if (!result.valid) {
      errors[field] = result.error;
      valid = false;
    }
  }

  // Cross-field validation
  if (
    config.minPurchaseAmount &&
    config.maxPurchaseAmount &&
    config.minPurchaseAmount > config.maxPurchaseAmount
  ) {
    errors.maxPurchaseAmount = 'Maximum purchase must be greater than minimum purchase';
    valid = false;
  }

  return { valid, errors };
}

/**
 * Format a basis point value as a percentage string
 * @param {number} basisPoints - Value in basis points (100 = 1%)
 * @returns {string} Formatted percentage string
 */
export function formatBasisPoints(basisPoints) {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

/**
 * Parse a percentage string to basis points
 * @param {string} percentString - Percentage string (e.g., "2.5%")
 * @returns {number} Value in basis points
 */
export function parsePercentage(percentString) {
  const cleaned = percentString.replace('%', '').trim();
  const value = parseFloat(cleaned);
  if (isNaN(value)) return 0;
  return Math.round(value * 100);
}

/**
 * Format a duration in seconds to a human-readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Human-readable duration
 */
export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
  return `${Math.floor(seconds / 86400)} days`;
}

/**
 * Format a large number with commas
 * @param {number} num - The number to format
 * @returns {string} Formatted number string
 */
export function formatNumber(num) {
  return num.toLocaleString();
}
