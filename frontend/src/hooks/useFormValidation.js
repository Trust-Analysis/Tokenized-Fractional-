// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * useFormValidation — Advanced form validation with real-time feedback.
 *
 * Issue #299: Advanced Form Validation with Real-time Feedback
 *
 * Features:
 *   - Real-time validation as users type (with debouncing)
 *   - Clear, actionable error messages
 *   - Visual indicators (valid, invalid, pending)
 *   - Prevents form submission with invalid data
 *   - Custom validation rules per field type (wallet, email, numeric, etc.)
 *   - Cross-field validation (e.g., endDate > startDate)
 *   - ARIA attributes for screen readers (aria-invalid, aria-describedby)
 *   - Success feedback on valid submission
 *   - Field-level help text
 *
 * Usage:
 *   const { values, errors, touched, isValid, handleChange, handleBlur, handleSubmit } =
 *     useFormValidation({
 *       initialValues: { email: '', password: '' },
 *       validationRules: {
 *         email: [validators.required(), validators.email()],
 *         password: [validators.required(), validators.minLength(8)],
 *       },
 *       onSubmit: (values) => { ... },
 *     });
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

const DEBOUNCE_MS = 300;

// ── Built-in validators ───────────────────────────────────────────────────────

export const validators = {
  required: (message = 'This field is required') => (value) => {
    if (!value || (typeof value === 'string' && !value.trim())) return message;
    return null;
  },

  minLength: (min, message) => (value) => {
    if (!value) return null;
    if (String(value).length < min) return message || `Must be at least ${min} characters`;
    return null;
  },

  maxLength: (max, message) => (value) => {
    if (!value) return null;
    if (String(value).length > max) return message || `Must be at most ${max} characters`;
    return null;
  },

  email: (message = 'Please enter a valid email address') => (value) => {
    if (!value) return null;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(value)) return message;
    return null;
  },

  stellarAddress: (message = 'Please enter a valid Stellar address (starts with G)') => (value) => {
    if (!value) return null;
    if (!/^G[A-Z0-9]{55}$/.test(value)) return message;
    return null;
  },

  contractId: (message = 'Please enter a valid Soroban contract ID (starts with C)') => (value) => {
    if (!value) return null;
    if (!/^C[A-Z0-9]{55}$/.test(value)) return message;
    return null;
  },

  numeric: (message = 'Please enter a valid number') => (value) => {
    if (!value && value !== 0) return null;
    if (isNaN(Number(value))) return message;
    return null;
  },

  positiveNumber: (message = 'Must be a positive number') => (value) => {
    if (!value && value !== 0) return null;
    const num = Number(value);
    if (isNaN(num) || num <= 0) return message;
    return null;
  },

  range: (min, max, message) => (value) => {
    if (!value && value !== 0) return null;
    const num = Number(value);
    if (isNaN(num) || num < min || num > max) {
      return message || `Must be between ${min} and ${max}`;
    }
    return null;
  },

  pattern: (regex, message = 'Invalid format') => (value) => {
    if (!value) return null;
    if (!regex.test(value)) return message;
    return null;
  },

  url: (message = 'Please enter a valid URL') => (value) => {
    if (!value) return null;
    try {
      new URL(value);
      return null;
    } catch {
      return message;
    }
  },

  // Cross-field validator factory: must be after another field
  afterField: (otherFieldName, message) => (value, allValues) => {
    if (!value || !allValues[otherFieldName]) return null;
    const thisDate = new Date(value);
    const otherDate = new Date(allValues[otherFieldName]);
    if (thisDate <= otherDate) {
      return message || `Must be after ${otherFieldName}`;
    }
    return null;
  },

  // Cross-field validator factory: must match another field
  matchesField: (otherFieldName, message) => (value, allValues) => {
    if (!value) return null;
    if (value !== allValues[otherFieldName]) {
      return message || `Must match ${otherFieldName}`;
    }
    return null;
  },
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useFormValidation({
  initialValues = {},
  validationRules = {},
  onSubmit,
  validateOnBlur = true,
  validateOnChange = true,
  debounceMs = DEBOUNCE_MS,
}) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const debounceTimers = useRef({});

  // Validate a single field
  const validateField = useCallback((name, value, allVals) => {
    const rules = validationRules[name];
    if (!rules || !Array.isArray(rules)) return null;
    const currentValues = allVals || values;
    for (const rule of rules) {
      const error = rule(value, currentValues);
      if (error) return error;
    }
    return null;
  }, [validationRules, values]);

  // Validate all fields
  const validateAll = useCallback((allVals) => {
    const vals = allVals || values;
    const newErrors = {};
    let hasErrors = false;

    for (const fieldName of Object.keys(validationRules)) {
      const error = validateField(fieldName, vals[fieldName], vals);
      if (error) {
        newErrors[fieldName] = error;
        hasErrors = true;
      }
    }

    return { errors: newErrors, hasErrors };
  }, [validationRules, validateField, values]);

  // Check if form is valid (memoized)
  const isValid = useMemo(() => {
    const { hasErrors } = validateAll();
    return !hasErrors;
  }, [values, validateAll]);

  // Handle input change with debounced validation
  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;

    setValues((prev) => ({ ...prev, [name]: val }));
    setSubmitSuccess(false);

    if (validateOnChange) {
      // Clear existing timer
      if (debounceTimers.current[name]) {
        clearTimeout(debounceTimers.current[name]);
      }
      // Debounce validation
      debounceTimers.current[name] = setTimeout(() => {
        setValues((prev) => {
          const error = validateField(name, val, prev);
          setErrors((prevErrors) => ({ ...prevErrors, [name]: error }));
          return prev;
        });
      }, debounceMs);
    }
  }, [validateOnChange, validateField, debounceMs]);

  // Handle blur — validate immediately
  const handleBlur = useCallback((e) => {
    const { name, value } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));

    if (validateOnBlur) {
      const error = validateField(name, value);
      setErrors((prev) => ({ ...prev, [name]: error }));
    }
  }, [validateOnBlur, validateField]);

  // Handle form submission
  const handleSubmit = useCallback(async (e) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    setSubmitSuccess(false);

    // Mark all fields as touched
    const allTouched = {};
    Object.keys(validationRules).forEach((key) => { allTouched[key] = true; });
    setTouched(allTouched);

    // Validate all fields
    const { errors: newErrors, hasErrors } = validateAll();

    if (hasErrors) {
      setErrors(newErrors);
      setIsSubmitting(false);
      return;
    }

    try {
      if (onSubmit) await onSubmit(values);
      setSubmitSuccess(true);
      setErrors({});
    } catch (err) {
      setErrors({ _form: err.message || 'Submission failed' });
    } finally {
      setIsSubmitting(false);
    }
  }, [validationRules, validateAll, onSubmit, values]);

  // Reset form
  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setIsSubmitting(false);
    setSubmitSuccess(false);
  }, [initialValues]);

  // Set a field value programmatically
  const setFieldValue = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  // Clear debounce timers on unmount
  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach(clearTimeout);
    };
  }, []);

  // Get props for a form field (for spreading onto input/select)
  const getFieldProps = useCallback((name) => ({
    name,
    value: values[name] ?? '',
    onChange: handleChange,
    onBlur: handleBlur,
    'aria-invalid': !!errors[name],
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  }), [values, errors, handleChange, handleBlur]);

  return {
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
    setFieldValue,
    getFieldProps,
    validateField,
    validateAll,
  };
}

export default useFormValidation;
