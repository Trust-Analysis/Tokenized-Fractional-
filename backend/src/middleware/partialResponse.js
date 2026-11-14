/**
 * REST API Partial Response Support (#288)
 * 
 * Provides query parameter field selection, nested selection, field exclusion,
 * field aliasing, strict validation, response size estimation headers,
 * and field selection analytics.
 */

// Global telemetry for field selection analytics
export const fieldAnalytics = {};

export function resetFieldAnalytics() {
  Object.keys(fieldAnalytics).forEach((key) => {
    delete fieldAnalytics[key];
  });
}

export function getFieldAnalytics() {
  return { ...fieldAnalytics };
}

/**
 * Parse field selection syntax supporting aliases, dot notation, and nested parentheses
 * Example: "id:contractId,title,documents(name,hash)"
 */
export function parseFieldsString(fieldsStr) {
  if (!fieldsStr || typeof fieldsStr !== 'string') return null;

  const result = [];
  let buffer = '';
  let nestLevel = 0;

  for (let i = 0; i < fieldsStr.length; i += 1) {
    const char = fieldsStr[i];
    if (char === '(') {
      nestLevel += 1;
      buffer += char;
    } else if (char === ')') {
      nestLevel -= 1;
      buffer += char;
    } else if (char === ',' && nestLevel === 0) {
      if (buffer.trim()) result.push(buffer.trim());
      buffer = '';
    } else {
      buffer += char;
    }
  }
  if (buffer.trim()) result.push(buffer.trim());

  const fieldSpecs = {};

  result.forEach((token) => {
    let alias = null;
    let rawField = token;

    if (token.includes(':') && !token.includes('(')) {
      const parts = token.split(':');
      alias = parts[0].trim();
      rawField = parts[1].trim();
    }

    const nestMatch = rawField.match(/^([a-zA-Z0-9_\-\.]+)\((.+)\)$/);
    if (nestMatch) {
      const parent = nestMatch[1];
      const childStr = nestMatch[2];
      fieldSpecs[parent] = {
        alias,
        children: parseFieldsString(childStr),
      };
    } else if (rawField.includes('.')) {
      const parts = rawField.split('.');
      const parent = parts[0];
      const rest = parts.slice(1).join('.');
      if (!fieldSpecs[parent]) {
        fieldSpecs[parent] = { alias, children: {} };
      }
      fieldSpecs[parent].children = {
        ...fieldSpecs[parent].children,
        ...parseFieldsString(rest),
      };
    } else {
      fieldSpecs[rawField] = { alias, children: null };
    }
  });

  return fieldSpecs;
}

/**
 * Parse field exclusion string (e.g. "description,documents" or "-description")
 */
export function parseExcludeString(excludeStr) {
  if (!excludeStr || typeof excludeStr !== 'string') return [];
  return excludeStr
    .split(',')
    .map((s) => s.trim().replace(/^-/, ''))
    .filter(Boolean);
}

/**
 * Validate requested fields against target data structure
 */
function validateFields(data, fieldsSpecs, path = '') {
  if (!fieldsSpecs || typeof fieldsSpecs !== 'object') return [];
  const unknownFields = [];

  let sampleObj = data;
  if (Array.isArray(data)) {
    sampleObj = data[0];
  }

  if (!sampleObj || typeof sampleObj !== 'object') return [];

  const availableKeys = new Set(Object.keys(sampleObj));

  Object.keys(fieldsSpecs).forEach((fieldName) => {
    // Record analytics for field usage
    fieldAnalytics[fieldName] = (fieldAnalytics[fieldName] || 0) + 1;

    if (!availableKeys.has(fieldName)) {
      const fullPath = path ? `${path}.${fieldName}` : fieldName;
      unknownFields.push(fullPath);
    } else if (fieldsSpecs[fieldName].children && sampleObj[fieldName]) {
      const childUnknowns = validateFields(
        sampleObj[fieldName],
        fieldsSpecs[fieldName].children,
        path ? `${path}.${fieldName}` : fieldName
      );
      unknownFields.push(...childUnknowns);
    }
  });

  return unknownFields;
}

/**
 * Apply partial response field selection and exclusions on JS data
 */
export function applyPartialResponse(data, options = {}) {
  const {
    fields = null,
    exclude = null,
    strict = true,
  } = options;

  const fieldsSpecs = typeof fields === 'string' ? parseFieldsString(fields) : fields;
  const excludeList = typeof exclude === 'string' ? parseExcludeString(exclude) : (exclude || []);

  if (!fieldsSpecs && excludeList.length === 0) {
    return data;
  }

  if (strict && fieldsSpecs) {
    const unknownFields = validateFields(data, fieldsSpecs);
    if (unknownFields.length > 0) {
      const err = new Error(`Invalid field selection: unknown field(s) [${unknownFields.join(', ')}]`);
      err.statusCode = 400;
      err.unknownFields = unknownFields;
      throw err;
    }
  }

  const pruneValue = (value) => {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
      return value.map(pruneValue);
    }

    if (typeof value === 'object') {
      const result = {};
      const objKeys = Object.keys(value);

      objKeys.forEach((key) => {
        if (excludeList.includes(key)) return;

        if (fieldsSpecs) {
          if (!Object.prototype.hasOwnProperty.call(fieldsSpecs, key)) return;
          const spec = fieldsSpecs[key];
          const outputKey = spec.alias || key;

          if (spec.children && value[key] != null) {
            result[outputKey] = applyPartialResponse(value[key], {
              fields: spec.children,
              exclude: excludeList,
              strict: false,
            });
          } else {
            result[outputKey] = value[key];
          }
        } else {
          result[key] = value[key];
        }
      });

      return result;
    }

    return value;
  };

  return pruneValue(data);
}

/**
 * Express middleware for REST API partial responses
 */
export function partialResponseMiddleware(options = {}) {
  const { strict = true } = options;

  return (req, res, next) => {
    const fieldsQuery = req.query.fields || req.query['-fields'];
    const excludeQuery = req.query.exclude;

    if (!fieldsQuery && !excludeQuery) {
      return next();
    }

    const originalJson = res.json.bind(res);

    res.json = (data) => {
      try {
        const originalString = JSON.stringify(data);
        const originalSizeBytes = Buffer.byteLength(originalString, 'utf8');
        res.setHeader('X-Original-Size-Bytes', originalSizeBytes.toString());

        const prunedData = applyPartialResponse(data, {
          fields: fieldsQuery,
          exclude: excludeQuery,
          strict,
        });

        const prunedString = JSON.stringify(prunedData);
        const prunedSizeBytes = Buffer.byteLength(prunedString, 'utf8');
        res.setHeader('X-Response-Size-Bytes', prunedSizeBytes.toString());

        return originalJson(prunedData);
      } catch (err) {
        if (err.statusCode === 400) {
          res.status(400);
          return originalJson({
            error: 'Bad Request',
            message: err.message,
            unknownFields: err.unknownFields || [],
          });
        }
        return next(err);
      }
    };

    return next();
  };
}
