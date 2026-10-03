// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/validators/schemas.js — Validation schemas for all API endpoints (#260)
 * Lightweight schema-based validation without external dependencies.
 */

export class ValidationError extends Error {
  constructor(errors) {
    const first = errors[0]?.message || 'Validation failed';
    super(errors.length === 1 ? first : `${errors.length} validation errors found`);
    this.name = 'ValidationError';
    this.errors = errors;
    this.fieldErrors = errors.map((e) => ({
      field: e.path || '(root)',
      message: e.message,
      code: e.code || 'invalid',
    }));
  }
}

function makeOptional(chain) {
  const wrapper = Object.create(Object.getPrototypeOf(chain));
  const keys = Object.keys(chain);
  for (let i = 0; i < keys.length; i += 1) { wrapper[keys[i]] = chain[keys[i]]; }
  wrapper._optional = true;
  const originalParse = chain.parse;
  wrapper.parse = function (val, path) {
    if (val === undefined || val === null || val === '') return [];
    return originalParse.call(wrapper, val, path);
  };
  return wrapper;
}

export const s = {
  string() {
    const self = {
      _type: 'string', _optional: false, _min: null, _max: null,
      _regex: null, _regexMsg: null,
      _startsWith: null, _startsWithMsg: null,
      _url: false, _uuid: false, _enum: null, _refine: null, _refineMsg: null,
      optional() { return makeOptional(this); },
      min(n, msg) { this._min = { n, msg: msg || `Must be at least ${n} characters` }; return this; },
      max(n, msg) { this._max = { n, msg: msg || `Must be at most ${n} characters` }; return this; },
      regex(pattern, msg) { this._regex = { pattern, msg: msg || 'Invalid format' }; return this; },
      startsWith(prefix, msg) { this._startsWith = { prefix, msg: msg || `Must start with "${prefix}"` }; return this; },
      url(msg) { this._url = true; this._urlMsg = msg; return this; },
      uuid(msg) { this._uuid = true; this._uuidMsg = msg; return this; },
      enum(values, msg) { this._enum = { values, msg: msg || `Must be one of: ${values.join(', ')}` }; return this; },
      refine(fn, msg) { this._refine = fn; this._refineMsg = msg; return this; },
      parse(val, path) {
        if (val === undefined || val === null || val === '') { if (this._optional) return []; return [{ path, message: 'Required', code: 'required' }]; }
        if (typeof val !== 'string') return [{ path, message: `Expected string, got ${typeof val}`, code: 'type' }];
        if (this._min && val.length < this._min.n) return [{ path, message: this._min.msg, code: 'min_length' }];
        if (this._max && val.length > this._max.n) return [{ path, message: this._max.msg, code: 'max_length' }];
        if (this._regex && !this._regex.pattern.test(val)) return [{ path, message: this._regex.msg, code: 'regex' }];
        if (this._startsWith && !val.startsWith(this._startsWith.prefix)) return [{ path, message: this._startsWith.msg, code: 'starts_with' }];
        if (this._url) { try { const u = new URL(val); void u; } catch (e) { return [{ path, message: this._urlMsg || 'Must be a valid URL', code: 'url' }]; } }
        if (this._uuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) return [{ path, message: this._uuidMsg || 'Must be a valid UUID', code: 'uuid' }];
        if (this._enum && !this._enum.values.includes(val)) return [{ path, message: this._enum.msg, code: 'enum' }];
        if (this._refine && !this._refine(val)) return [{ path, message: this._refineMsg || 'Invalid value', code: 'refine' }];
        return [];
      },
    };
    return self;
  },

  number() {
    const self = {
      _type: 'number', _optional: false, _int: false, _positive: false, _min: null, _max: null,
      optional() { return makeOptional(this); },
      int(msg) { this._int = true; this._intMsg = msg; return this; },
      positive(msg) { this._positive = true; this._positiveMsg = msg; return this; },
      min(n, msg) { this._min = { n, msg: msg || `Must be at least ${n}` }; return this; },
      max(n, msg) { this._max = { n, msg: msg || `Must be at most ${n}` }; return this; },
      parse(val, path) {
        if (val === undefined || val === null) { if (this._optional) return []; return [{ path, message: 'Required', code: 'required' }]; }
        const num = Number(val);
        if (isNaN(num)) return [{ path, message: `Expected number, got ${typeof val}`, code: 'type' }];
        if (this._int && !Number.isInteger(num)) return [{ path, message: this._intMsg || 'Must be an integer', code: 'int' }];
        if (this._positive && num <= 0) return [{ path, message: this._positiveMsg || 'Must be positive', code: 'positive' }];
        if (this._min && num < this._min.n) return [{ path, message: this._min.msg, code: 'min' }];
        if (this._max && num > this._max.n) return [{ path, message: this._max.msg, code: 'max' }];
        return [];
      },
    };
    return self;
  },

  object(shape) {
    const self = {
      _type: 'object', _shape: shape, _optional: false,
      optional() { return makeOptional(this); },
      parse(val, path) {
        if (val === undefined || val === null) { if (this._optional) return []; return [{ path, message: 'Required', code: 'required' }]; }
        if (typeof val !== 'object' || Array.isArray(val)) return [{ path, message: `Expected object, got ${typeof val}`, code: 'type' }];
        const errors = [];
        const shapeKeys = Object.keys(this._shape);
        for (let i = 0; i < shapeKeys.length; i += 1) {
          const key = shapeKeys[i];
          const childPath = path ? `${path}.${key}` : key;
          const childErrors = this._shape[key].parse(val[key], childPath);
          if (childErrors && childErrors.length > 0) errors.push(...childErrors);
        }
        return errors;
      },
    };
    return self;
  },

  array(itemSchema) {
    const self = {
      _type: 'array', _itemSchema: itemSchema, _optional: false, _min: null, _max: null,
      optional() { return makeOptional(this); },
      min(n, msg) { this._min = { n, msg: msg || `Must have at least ${n} items` }; return this; },
      max(n, msg) { this._max = { n, msg: msg || `Must have at most ${n} items` }; return this; },
      parse(val, path) {
        if (val === undefined || val === null) { if (this._optional) return []; return [{ path, message: 'Required', code: 'required' }]; }
        if (!Array.isArray(val)) return [{ path, message: `Expected array, got ${typeof val}`, code: 'type' }];
        if (this._min && val.length < this._min.n) return [{ path, message: this._min.msg, code: 'min_items' }];
        if (this._max && val.length > this._max.n) return [{ path, message: this._max.msg, code: 'max_items' }];
        const errors = [];
        if (this._itemSchema) {
          for (let i = 0; i < val.length; i += 1) {
            const childPath = path ? `${path}[${i}]` : `[${i}]`;
            const childErrors = this._itemSchema.parse(val[i], childPath);
            if (childErrors && childErrors.length > 0) errors.push(...childErrors);
          }
        }
        return errors;
      },
    };
    return self;
  },

  boolean() {
    const self = {
      _type: 'boolean', _optional: false,
      optional() { return makeOptional(this); },
      parse(val, path) {
        if (val === undefined || val === null) { if (this._optional) return []; return [{ path, message: 'Required', code: 'required' }]; }
        if (typeof val !== 'boolean') return [{ path, message: `Expected boolean, got ${typeof val}`, code: 'type' }];
        return [];
      },
    };
    return self;
  },

  any() {
    const self = { _type: 'any', _optional: false, optional() { return makeOptional(this); }, parse() { return []; } };
    return self;
  },

  validate(schema, data) {
    const errors = schema.parse(data, '');
    if (errors && errors.length > 0) return new ValidationError(errors);
    return null;
  },
};

// ── Reusable schema fragments ─────────────────────────────────────────────────
export const contractIdSchema = s.string().min(50, 'Contract ID must be at least 50 characters').startsWith('C', 'Contract ID must start with "C"');
export const nonEmptyString = s.string().min(1, 'Must not be empty');
export const isoDateSchema = s.string().refine((v) => !isNaN(Date.parse(v)), 'Must be a valid ISO 8601 date string');
export const positiveIntSchema = s.number().int().positive();
export const futureDateSchema = s.string().optional().refine((v) => { if (!v) return true; const d = new Date(v); return !isNaN(d.getTime()) && d > new Date(); }, 'Must be a valid future date');
export const urlSchema = s.string().url('Must be a valid URL');

export const contractIdParamSchema = s.object({ contractId: contractIdSchema });
export const apiKeyIdParamSchema = s.object({ id: s.string().min(1, 'API key ID is required') });
export const webhookIdParamSchema = s.object({ id: s.string().min(1, 'Webhook ID is required').startsWith('wh_', 'Webhook ID must start with wh_') });
export const transactionIdParamSchema = s.object({ transactionId: s.string().min(1, 'Transaction ID is required') });
export const userAddressParamSchema = s.object({ address: s.string().min(10, 'Address must be at least 10 characters') });
export const documentCidParamSchema = s.object({ contractId: contractIdSchema, cid: s.string().min(1, 'Document CID is required') });

// ── Query schemas ─────────────────────────────────────────────────────────────
export const paginationQuerySchema = s.object({
  page: s.number().int().positive().optional(),
  limit: s.number().int().min(1).max(100).optional(),
  offset: s.number().int().min(0).optional(),
});

export const assetListQuerySchema = s.object({
  page: s.number().int().positive().optional(),
  limit: s.number().int().min(1).max(100).optional(),
  offset: s.number().int().min(0).optional(),
  assetType: s.string().optional(), location: s.string().optional(), search: s.string().optional(),
});

export const assetSearchQuerySchema = s.object({
  page: s.number().int().positive().optional(),
  limit: s.number().int().min(1).max(100).optional(),
  q: s.string().min(1, 'Search query "q" is required'),
  assetType: s.string().optional(), location: s.string().optional(),
});

export const assetExportQuerySchema = s.object({
  format: s.string().enum(['json', 'csv']).optional(),
  from: isoDateSchema.optional(), to: isoDateSchema.optional(),
});

export const analyticsQuerySchema = s.object({
  days: s.number().int().min(1).max(365).optional(),
  interval: s.string().enum(['day', 'week', 'month']).optional(),
  period: s.string().enum(['week', 'month', 'all']).optional(),
  from: isoDateSchema.optional(), to: isoDateSchema.optional(),
});

export const dailyAnalyticsQuerySchema = s.object({
  from: isoDateSchema.optional(), to: isoDateSchema.optional(),
  limit: s.number().int().min(1).max(365).optional(),
});

export const apiKeyListQuerySchema = s.object({ includeRevoked: s.string().enum(['true', 'false']).optional() });
export const apiKeyDeleteQuerySchema = s.object({ hardDelete: s.string().enum(['true', 'false']).optional() });

// ── Body schemas ──────────────────────────────────────────────────────────────
export const rwaAssetBodySchema = s.object({
  contractId: contractIdSchema,
  id: s.string().optional(),
  title: s.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
  location: s.string().min(1, 'Location is required').max(200),
  description: s.string().min(1, 'Description is required').max(5000),
  assetType: s.string().min(1, 'Asset type is required').max(100),
  imageUrl: s.string().optional(), totalValuation: s.string().optional(),
  documents: s.array(s.any()).optional(),
  status: s.string().enum(['pending', 'approved', 'rejected']).optional(),
  createdAt: isoDateSchema.optional(),
});

export const rwaAssetPatchSchema = s.object({
  title: s.string().min(1).max(200).optional(),
  location: s.string().min(1).max(200).optional(),
  description: s.string().min(1).max(5000).optional(),
  assetType: s.string().min(1).max(100).optional(),
  imageUrl: s.string().optional(), totalValuation: s.string().optional(),
  documents: s.array(s.any()).optional(),
});

export const purchaseBodySchema = s.object({
  contractId: s.string().min(1, 'contractId is required').startsWith('C', 'contractId must start with C'),
  buyerAddress: s.string().min(10, 'buyerAddress must be at least 10 characters'),
  sharesPurchased: s.number().positive('sharesPurchased must be a positive number'),
  pricePerShare: s.number().positive('pricePerShare must be a positive number'),
  totalAmount: s.number().positive('totalAmount must be a positive number'),
  paymentToken: nonEmptyString,
  blockchainHash: s.string().optional().regex(/^[0-9a-fA-F]{64}$/, 'Must be a valid 64-character hex hash'),
});

export const apiKeyCreateBodySchema = s.object({
  name: s.string().min(1, 'API key name is required').max(100),
  description: s.string().optional(), expiresAt: futureDateSchema,
});

export const apiKeyRotateBodySchema = s.object({ description: s.string().optional(), expiresAt: futureDateSchema });

export const webhookBodySchema = s.object({
  url: urlSchema,
  events: s.array(s.string().min(1)).min(1, 'events must be a non-empty array'),
  secret: s.string().optional(), active: s.boolean().optional(),
  eventTypes: s.array(s.string()).optional(), ipWhitelist: s.array(s.string()).optional(),
  description: s.string().optional(), encrypted: s.boolean().optional(),
});

export const webhookUpdateBodySchema = s.object({
  active: s.boolean().optional(), events: s.array(s.string().min(1)).optional(),
  eventTypes: s.array(s.string()).optional(), url: urlSchema.optional(),
  secret: s.string().optional(), ipWhitelist: s.array(s.string()).optional(),
  description: s.string().optional(),
});

export const computeDailyBodySchema = s.object({
  date: s.string().refine((v) => !isNaN(Date.parse(v)), 'date must be a valid ISO date string (YYYY-MM-DD)').optional(),
});

export const batchOperationSchema = s.object({
  method: s.string().enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']),
  path: s.string().min(1).startsWith('/', 'path must start with /'),
  body: s.any().optional(), headers: s.any().optional(),
  dependsOn: s.number().int().min(0).optional(),
});

export const batchRequestBodySchema = s.array(batchOperationSchema).min(1).max(20);

// ── Route schema map ──────────────────────────────────────────────────────────
export const routeSchemas = {
  'GET /rwa': { query: assetListQuerySchema },
  'GET /rwa/search': { query: assetSearchQuerySchema },
  'GET /rwa/export': { query: assetExportQuerySchema },
  'GET /rwa/pending': {},
  'GET /rwa/:contractId': { params: contractIdParamSchema },
  'POST /rwa': { body: rwaAssetBodySchema },
  'PATCH /rwa/:contractId': { params: contractIdParamSchema, body: rwaAssetPatchSchema },
  'DELETE /rwa/:contractId': { params: contractIdParamSchema },
  'POST /rwa/:contractId/documents': { params: contractIdParamSchema },
  'GET /rwa/:contractId/documents/:cid': { params: documentCidParamSchema },
  'POST /rwa/:contractId/approve': { params: contractIdParamSchema },
  'POST /rwa/:contractId/reject': { params: contractIdParamSchema },
  'POST /purchases': { body: purchaseBodySchema },
  'GET /purchases/:transactionId': { params: transactionIdParamSchema },
  'GET /purchases/contract/:contractId': { params: contractIdParamSchema },
  'GET /analytics/overview': {},
  'GET /analytics/volume': { query: analyticsQuerySchema },
  'GET /analytics/popular': {},
  'GET /analytics/active-users': { query: s.object({ period: s.string().enum(['week', 'month', 'all']).optional() }) },
  'GET /analytics/top-buyers': {},
  'GET /analytics/purchase-trends': { query: analyticsQuerySchema },
  'GET /analytics/asset-performance/:contractId': { params: contractIdParamSchema },
  'GET /analytics/user/:address': { params: userAddressParamSchema },
  'GET /analytics/dashboard': {},
  'POST /analytics/compute-daily': { body: computeDailyBodySchema },
  'GET /analytics/daily': { query: dailyAnalyticsQuerySchema },
  'GET /analytics/anomalies': {},
  'GET /analytics/capacity-forecast': {},
  'GET /analytics/export': {},
  'POST /api-keys': { body: apiKeyCreateBodySchema },
  'GET /api-keys': { query: apiKeyListQuerySchema },
  'GET /api-keys/:id': { params: apiKeyIdParamSchema },
  'GET /api-keys/:id/usage': { params: apiKeyIdParamSchema },
  'POST /api-keys/:id/rotate': { params: apiKeyIdParamSchema, body: apiKeyRotateBodySchema },
  'DELETE /api-keys/:id': { params: apiKeyIdParamSchema, query: apiKeyDeleteQuerySchema },
  'POST /webhooks': { body: webhookBodySchema },
  'GET /webhooks': {},
  'GET /webhooks/analytics': {},
  'GET /webhooks/events': {},
  'GET /webhooks/:id': { params: webhookIdParamSchema },
  'PATCH /webhooks/:id': { params: webhookIdParamSchema, body: webhookUpdateBodySchema },
  'DELETE /webhooks/:id': { params: webhookIdParamSchema },
  'POST /webhooks/:id/test': { params: webhookIdParamSchema },
  'GET /webhooks/:id/deliveries': { params: webhookIdParamSchema },
  'POST /batch': { body: batchRequestBodySchema },
};

export const SCHEMA_VERSION = '1.0.0';

export function getRouteSchema(method, path) {
  return routeSchemas[`${method.toUpperCase()} ${path}`] || null;
}

export function hasRouteValidation(method, path) {
  return !!getRouteSchema(method, path);
}
