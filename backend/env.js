/**
 * Environment configuration validation.
 * Call validateEnv() once at startup before any other initialisation.
 * Exits with a non-zero code and a clear error listing all missing/invalid vars.
 */

const RULES = [
  {
    key: 'ADMIN_API_KEY',
    required: true,
    validate: (v) => v.length >= 16,
    description: 'Admin API key for write operations (min 16 chars)',
    invalid: 'must be at least 16 characters',
  },
  {
    key: 'CORS_ORIGINS',
    required: true,
    validate: (v) => v.trim().length > 0,
    description: 'Comma-separated list of allowed CORS origins',
    invalid: 'must not be empty',
  },
  {
    key: 'PORT',
    required: false,
    validate: (v) => Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536,
    description: 'Port the server listens on (default: 3001)',
    invalid: 'must be a valid port number (1–65535)',
  },
  {
    key: 'CACHE_TTL_SECONDS',
    required: false,
    validate: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
    description: 'Redis cache TTL in seconds',
    invalid: 'must be a positive integer',
  },
  {
    key: 'CDN_URL',
    required: false,
    validate: (v) => isValidHttpUrl(v),
    description: 'Default CDN base URL for generated asset URLs',
    invalid: 'must be a valid http(s) URL',
  },
  {
    key: 'ASSET_CDN_URL',
    required: false,
    validate: (v) => isValidHttpUrl(v),
    description: 'CDN base URL for uploaded images and documents',
    invalid: 'must be a valid http(s) URL',
  },
];

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateEnv() {
  // Skip strict validation in test environment
  if (process.env.NODE_ENV === 'test') return;

  const errors = [];

  for (const rule of RULES) {
    const value = process.env[rule.key];

    if (!value) {
      if (rule.required) {
        errors.push(`  ✗ ${rule.key} is required — ${rule.description}`);
      }
      continue;
    }

    if (rule.validate && !rule.validate(value)) {
      errors.push(`  ✗ ${rule.key}="${value}" is invalid — ${rule.invalid}`);
    }
  }

  if (errors.length > 0) {
    console.error('\n❌  Environment configuration errors:\n');
    errors.forEach((e) => console.error(e));
    console.error('\nCopy backend/.env.example to backend/.env and fill in the required values.\n');
    process.exit(1);
  }
}
