// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/middleware/assetMetadataValidation.js — JSON Schema validation for asset metadata.
 *
 * Validates asset metadata against asset-metadata-v1.json schema before minting,
 * providing detailed field-level error messages for validation failures.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../services/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load JSON Schema
let schema;
let ajvInstance;

/**
 * Initialize AJV validator with asset metadata schema
 */
function initializeValidator() {
  try {
    const schemaPath = join(__dirname, '../../schemas/asset-metadata-v1.json');
    const schemaContent = readFileSync(schemaPath, 'utf-8');
    schema = JSON.parse(schemaContent);

    ajvInstance = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false,
      validateSchema: true,
    });

    addFormats(ajvInstance);
    ajvInstance.addSchema(schema, 'asset-metadata-v1');

    logger.info('Asset metadata validator initialized successfully');
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to initialize asset metadata validator');
    throw new Error('Validator initialization failed');
  }
}

/**
 * Validate asset metadata against schema
 */
export function validateAssetMetadata(metadata) {
  if (!ajvInstance) {
    initializeValidator();
  }

  const validate = ajvInstance.getSchema('asset-metadata-v1');
  const valid = validate(metadata);

  if (valid) {
    return { valid: true, errors: null };
  }

  // Format errors for detailed field-level messages
  const formattedErrors = validate.errors.map(error => {
    const field = error.instancePath || error.dataPath || 'root';
    const message = formatErrorMessage(error);
    
    return {
      field,
      message,
      value: error.data,
      schemaPath: error.schemaPath,
      keyword: error.keyword,
    };
  });

  return {
    valid: false,
    errors: formattedErrors,
  };
}

/**
 * Format AJV error messages for user-friendly output
 */
function formatErrorMessage(error) {
  const { keyword, params, data } = error;

  switch (keyword) {
    case 'required':
      return `Missing required field: ${params.missingProperty}`;
    
    case 'type':
      return `Expected type '${params.type}' but got '${typeof data}'`;
    
    case 'minimum':
      return `Value must be at least ${params.limit}`;
    
    case 'maximum':
      return `Value must be at most ${params.limit}`;
    
    case 'minLength':
      return `Minimum length is ${params.limit} characters`;
    
    case 'maxLength':
      return `Maximum length is ${params.limit} characters`;
    
    case 'pattern':
      return `Value does not match required pattern`;
    
    case 'enum':
      return `Value must be one of: ${params.allowedValues.join(', ')}`;
    
    case 'format':
      return `Invalid format for ${params.format}`;
    
    case 'minItems':
      return `Minimum ${params.limit} items required`;
    
    case 'maxItems':
      return `Maximum ${params.limit} items allowed`;
    
    case 'const':
      return `Value must be exactly '${params.allowedValue}'`;
    
    case 'additionalProperties':
      return `Additional property '${params.additionalProperty}' is not allowed`;
    
    default:
      return error.message || 'Validation failed';
  }
}

/**
 * Express middleware for validating asset metadata
 */
export function assetMetadataValidationMiddleware(req, res, next) {
  try {
    const metadata = req.body;

    if (!metadata || typeof metadata !== 'object') {
      return res.status(400).json({
        error: 'Invalid request body',
        code: 'INVALID_BODY',
        details: 'Request body must be a JSON object',
      });
    }

    const validation = validateAssetMetadata(metadata);

    if (!validation.valid) {
      logger.warn(
        { 
          correlationId: req.correlationId,
          errors: validation.errors,
        },
        'Asset metadata validation failed'
      );

      return res.status(400).json({
        error: 'Asset metadata validation failed',
        code: 'VALIDATION_ERROR',
        details: validation.errors,
      });
    }

    // Attach validated metadata to request
    req.validatedMetadata = metadata;
    next();
  } catch (error) {
    logger.error(
      { 
        correlationId: req.correlationId,
        error: error.message,
      },
      'Validation middleware error'
    );

    return res.status(500).json({
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      details: 'An error occurred during validation',
    });
  }
}

/**
 * GraphQL resolver wrapper for metadata validation
 */
export function withMetadataValidation(resolverFn) {
  return async (parent, args, context, info) {
    const metadata = args.metadata || args.input?.metadata;

    if (metadata) {
      const validation = validateAssetMetadata(metadata);

      if (!validation.valid) {
        throw new Error(
          JSON.stringify({
            code: 'VALIDATION_ERROR',
            details: validation.errors,
          })
        );
      }
    }

    return resolverFn(parent, args, context, info);
  };
}

/**
 * Reinitialize validator (useful for testing or schema updates)
 */
export function reinitializeValidator() {
  ajvInstance = null;
  schema = null;
  initializeValidator();
}

export default validateAssetMetadata;
