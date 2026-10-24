/**
 * Environment configuration validation (issue #711).
 *
 * `validateEnv()` is called once at startup, before any other initialisation.
 * It fails fast — logging every problem at once and exiting non-zero — so a
 * misconfigured deployment (e.g. a missing or too-short ADMIN_API_KEY) crashes
 * visibly at boot instead of silently authenticating wrong later on.
 *
 * The rule set is also exposed as a pure `collectEnvErrors(env)` so it can be
 * unit-tested without spawning a process.
 */

const NODE_ENVS = ['development', 'test', 'production', 'staging'];
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Reject absolute paths, traversal and unexpected extensions for file-backed
 * stores so a bad DATA_FILE cannot make the service read/write outside the
 * backend directory.
 */
function isSafeRelativeFile(value, extension) {
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return false;
  if (trimmed.split(/[\\/]/).includes('..')) return false;
  return trimmed.toLowerCase().endsWith(extension);
}

function redact(rule, value) {
  if (!rule.secret) return value;
  return value ? '<redacted>' : value;
}

/**
 * A startup-configuration rule.
 *
 * @property {string}   key         Environment variable name.
 * @property {boolean}  required    Whether the process must refuse to start without it.
 * @property {boolean}  [secret]    Redact the value in diagnostics when true.
 * @property {string}   description Human-readable purpose (used in error output).
 * @property {(v:string)=>boolean} [validate] Extra predicate for present values.
 * @property {string}   [invalid]   Explanation shown when `validate` fails.
 */
const RULES = [
  {
    key: 'ADMIN_API_KEY',
    required: true,
    secret: true,
    description: 'Admin API key for write operations (required, min 16 characters)',
    validate: (v) => v.trim().length >= 16,
    invalid: 'must be at least 16 characters',
  },
  {
    key: 'CORS_ORIGINS',
    required: true,
    description: 'Comma-separated list of allowed CORS origins',
    validate: (v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .every((origin) => origin === '*' || isValidHttpUrl(origin)),
    invalid: 'each entry must be a valid http(s) origin or "*"',
  },
  {
    key: 'DATA_FILE',
    required: true,
    description: 'Path to the JSON asset data file, relative to the backend directory',
    validate: (v) => isSafeRelativeFile(v, '.json'),
    invalid: 'must be a relative path ending in ".json" without ".." segments',
  },
  {
    key: 'PORT',
    required: false,
    description: 'Port the server listens on (default: 3001)',
    validate: (v) => Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536,
    invalid: 'must be a valid port number (1–65535)',
  },
  {
    key: 'NODE_ENV',
    required: false,
    description: 'Runtime environment (default: development)',
    validate: (v) => NODE_ENVS.includes(v),
    invalid: `must be one of ${NODE_ENVS.join(', ')}`,
  },
  {
    key: 'LOG_LEVEL',
    required: false,
    description: 'Minimum structured log level (default: info)',
    validate: (v) => LOG_LEVELS.includes(v),
    invalid: `must be one of ${LOG_LEVELS.join(', ')}`,
  },
  {
    key: 'CACHE_TTL_SECONDS',
    required: false,
    description: 'Redis cache TTL in seconds',
    validate: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
    invalid: 'must be a positive integer',
  },
  {
    key: 'WEBHOOK_DATA_FILE',
    required: false,
    description: 'Path to the JSON webhook store (default: webhooks.json)',
    validate: (v) => isSafeRelativeFile(v, '.json'),
    invalid: 'must be a relative path ending in ".json" without ".." segments',
  },
  {
    key: 'REDIS_URL',
    required: false,
    secret: true,
    description: 'Redis connection URL (redis:// or rediss://). Optional.',
    validate: (v) => /^rediss?:\/\//i.test(v),
    invalid: 'must start with redis:// or rediss://',
  },
  {
    key: 'PINATA_JWT',
    required: false,
    secret: true,
    description: 'Pinata JWT for IPFS document uploads. Optional.',
    validate: (v) => v.trim().length > 0,
    invalid: 'must not be empty if set',
  },
  {
    key: 'PINATA_GATEWAY',
    required: false,
    description: 'IPFS gateway base URL (default: https://gateway.pinata.cloud)',
    validate: isValidHttpUrl,
    invalid: 'must be a valid http(s) URL',
  },
  {
    key: 'CDN_URL',
    required: false,
    description: 'CDN base URL used for relative asset paths. Optional.',
    validate: isValidHttpUrl,
    invalid: 'must be a valid http(s) URL',
  },
  {
    key: 'SENTRY_DSN',
    required: false,
    secret: true,
    description: 'Sentry DSN for error tracking. Optional (logs only when unset).',
    validate: isValidHttpUrl,
    invalid: 'must be a valid DSN URL',
  },
];

/**
 * Collect every configuration problem for the given environment. Pure — no
 * process access, no exit — so it is directly unit-testable.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ key: string, message: string }[]}
 */
export function collectEnvErrors(env = process.env) {
  return RULES.flatMap((rule) => {
    const raw = env[rule.key];
    const missing = raw === undefined || raw === null || String(raw).trim() === '';

    if (missing) {
      return rule.required
        ? [{ key: rule.key, message: `${rule.key} is required — ${rule.description}` }]
        : [];
    }

    if (rule.validate && !rule.validate(raw)) {
      return [
        {
          key: rule.key,
          message: `${rule.key}="${redact(rule, raw)}" is invalid — ${rule.invalid}`,
        },
      ];
    }

    return [];
  });
}

/**
 * Render collected errors as the human-readable block printed at startup.
 */
export function formatEnvErrors(errors) {
  return [
    '',
    '❌  Environment configuration errors:',
    '',
    ...errors.map((e) => `  ✗ ${e.message}`),
    '',
    'Copy backend/.env.example to backend/.env and fill in the required values,',
    'or set the variables in your deployment dashboard. See README.md',
    '("Environment variables") for the full list and validation rules.',
    '',
  ].join('\n');
}

/**
 * Validate the environment and terminate the process with a clear message if
 * anything required is missing or invalid.
 *
 * Skipped under NODE_ENV=test so the unit/integration suites can run without a
 * full production environment.
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {{ exitCode?: number, exit?: (code:number)=>void }} [options]
 * @returns {{ key: string, message: string }[]} the errors found (empty when valid)
 */
export function validateEnv(env = process.env, options = {}) {
  if (env.NODE_ENV === 'test') return [];

  const errors = collectEnvErrors(env);

  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error(formatEnvErrors(errors));
    const exit = options.exit || ((code) => process.exit(code));
    exit(options.exitCode === undefined ? 1 : options.exitCode);
  }

  return errors;
}
