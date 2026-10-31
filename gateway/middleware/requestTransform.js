/**
 * Request/Response Transformation Utilities
 * Handles data mapping, validation, and standardization
 */

/**
 * Request transformer middleware
 */
export class RequestTransformer {
  constructor(options = {}) {
    this.headerTransforms = options.headerTransforms || {};
    this.bodyTransforms = options.bodyTransforms || {};
    this.queryTransforms = options.queryTransforms || {};
    this.removeHeaders = options.removeHeaders || [];
    this.removeFields = options.removeFields || [];
  }

  /**
   * Transform incoming request
   */
  transform(req) {
    const transformed = {
      headers: this.transformHeaders(req.headers),
      body: this.transformBody(req.body),
      query: this.transformQuery(req.query),
      path: req.path,
      method: req.method,
    };

    return transformed;
  }

  transformHeaders(headers) {
    const result = { ...headers };

    // Remove sensitive headers
    for (const header of this.removeHeaders) {
      delete result[header.toLowerCase()];
    }

    // Apply transformations
    for (const [key, transform] of Object.entries(this.headerTransforms)) {
      if (result[key]) {
        result[key] = typeof transform === 'function' ? transform(result[key]) : transform;
      }
    }

    // Add standard headers
    result['x-transformed'] = 'true';
    result['x-transform-timestamp'] = new Date().toISOString();

    return result;
  }

  transformBody(body) {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const result = { ...body };

    // Remove fields
    for (const field of this.removeFields) {
      delete result[field];
    }

    // Apply transformations
    for (const [key, transform] of Object.entries(this.bodyTransforms)) {
      if (result[key] !== undefined) {
        result[key] = typeof transform === 'function' ? transform(result[key]) : transform;
      }
    }

    return result;
  }

  transformQuery(query) {
    if (!query || typeof query !== 'object') {
      return query;
    }

    const result = { ...query };

    for (const [key, transform] of Object.entries(this.queryTransforms)) {
      if (result[key] !== undefined) {
        result[key] = typeof transform === 'function' ? transform(result[key]) : transform;
      }
    }

    return result;
  }
}

/**
 * Response transformer middleware
 */
export class ResponseTransformer {
  constructor(options = {}) {
    this.headerTransforms = options.headerTransforms || {};
    this.bodyTransforms = options.bodyTransforms || {};
    this.removeHeaders = options.removeHeaders || [];
    this.removeFields = options.removeFields || [];
    this.addHeaders = options.addHeaders || {};
    this.addFields = options.addFields || {};
  }

  /**
   * Transform outgoing response
   */
  transform(response, statusCode = 200) {
    const transformed = {
      statusCode,
      headers: this.transformHeaders(response.headers || {}),
      body: this.transformBody(response.body || response),
    };

    return transformed;
  }

  transformHeaders(headers) {
    const result = { ...headers };

    // Remove headers
    for (const header of this.removeHeaders) {
      delete result[header.toLowerCase()];
    }

    // Apply transformations
    for (const [key, transform] of Object.entries(this.headerTransforms)) {
      if (result[key]) {
        result[key] = typeof transform === 'function' ? transform(result[key]) : transform;
      }
    }

    // Add headers
    for (const [key, value] of Object.entries(this.addHeaders)) {
      result[key] = typeof value === 'function' ? value() : value;
    }

    // Add standard headers
    result['x-transformed'] = 'true';
    result['x-transform-timestamp'] = new Date().toISOString();

    return result;
  }

  transformBody(body) {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const result = { ...body };

    // Remove fields
    for (const field of this.removeFields) {
      delete result[field];
    }

    // Apply transformations
    for (const [key, transform] of Object.entries(this.bodyTransforms)) {
      if (result[key] !== undefined) {
        result[key] = typeof transform === 'function' ? transform(result[key]) : transform;
      }
    }

    // Add fields
    for (const [key, value] of Object.entries(this.addFields)) {
      result[key] = typeof value === 'function' ? value() : value;
    }

    // Add metadata
    result._metadata = {
      transformedAt: new Date().toISOString(),
      version: '1.0',
    };

    return result;
  }
}

/**
 * Request/Response mapping for different formats
 */
export const TRANSFORMATIONS = {
  // XML to JSON transformation
  xmlToJson: (xmlString) => {
    // Use a library like xml2js in production
    try {
      return JSON.parse(xmlString);
    } catch {
      return null;
    }
  },

  // JSON to XML transformation
  jsonToXml: (jsonObject) => {
    // Use a library like js2xmlparser in production
    return JSON.stringify(jsonObject);
  },

  // Normalize timestamps
  normalizeTimestamp: (timestamp) => {
    if (typeof timestamp === 'string') {
      return new Date(timestamp).toISOString();
    }
    if (typeof timestamp === 'number') {
      return new Date(timestamp * 1000).toISOString();
    }
    return timestamp;
  },

  // Format currency
  formatCurrency: (amount, currency = 'USD') => {
    if (typeof amount !== 'number') return amount;
    return {
      amount: parseFloat(amount.toFixed(2)),
      currency,
      formatted: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).format(amount),
    };
  },

  // Redact sensitive fields
  redactSensitive: (data) => {
    const redacted = { ...data };
    const sensitiveFields = ['password', 'apiKey', 'secret', 'token', 'ssn', 'creditCard'];

    const redactObject = (obj) => {
      for (const key in obj) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
          obj[key] = '***REDACTED***';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          redactObject(obj[key]);
        }
      }
    };

    redactObject(redacted);
    return redacted;
  },

  // Validate contract ID format
  validateContractId: (id) => {
    if (typeof id !== 'string') return null;
    // Contract IDs start with 'C' and are at least 50 characters
    return /^C[A-Za-z0-9]{49,}$/.test(id) ? id : null;
  },
};

/**
 * Create a transformation middleware
 */
export function createTransformMiddleware(transformer, location = 'body') {
  return (req, res, next) => {
    try {
      if (location === 'request') {
        req.transformed = transformer.transform(req);
      } else if (location === 'response') {
        // Intercept response.json()
        const originalJson = res.json.bind(res);
        res.json = function(data) {
          const transformed = transformer.transform(data, res.statusCode);
          return originalJson.call(this, transformed.body);
        };
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Data validation middleware
 */
export function validateSchema(schema) {
  return (req, res, next) => {
    try {
      const errors = [];

      // Validate required fields
      if (schema.required) {
        for (const field of schema.required) {
          if (req.body[field] === undefined) {
            errors.push(`Missing required field: ${field}`);
          }
        }
      }

      // Validate field types
      if (schema.properties) {
        for (const [field, rules] of Object.entries(schema.properties)) {
          if (req.body[field] !== undefined) {
            if (rules.type && typeof req.body[field] !== rules.type) {
              errors.push(`Field ${field} must be type ${rules.type}`);
            }
            if (rules.minLength && req.body[field].length < rules.minLength) {
              errors.push(`Field ${field} must be at least ${rules.minLength} characters`);
            }
            if (rules.maxLength && req.body[field].length > rules.maxLength) {
              errors.push(`Field ${field} must be at most ${rules.maxLength} characters`);
            }
            if (rules.pattern && !rules.pattern.test(req.body[field])) {
              errors.push(`Field ${field} format is invalid`);
            }
          }
        }
      }

      if (errors.length > 0) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Request body validation failed',
          code: 'VALIDATION_ERROR',
          errors,
          requestId: req.requestId,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Response standardization middleware
 */
export function standardizeResponse(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function(data) {
    const response = {
      success: res.statusCode < 400,
      statusCode: res.statusCode,
      data: res.statusCode < 400 ? data : undefined,
      error: res.statusCode >= 400 ? data : undefined,
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
        version: '1.0',
      },
    };

    return originalJson.call(this, response);
  };

  next();
}
