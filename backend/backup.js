/**
 * Database backup automation.
 *
 * Produces verifiable, rotated snapshots of every persistent data source the
 * backend owns:
 *   - JSON data files (data.json, webhooks.json)
 *   - The SQL database — SQLite in dev/test, PostgreSQL (via pg_dump) in prod
 *
 * Each backup is a directory `backups/backup-<timestamp>/` containing one
 * gzipped member per source plus a `manifest.json` recording the SHA-256 of
 * every source. The manifest is what `verifyBackup()` checks against, so a
 * corrupted or truncated member is detected before it is ever relied upon.
 *
 * The core (create / verify / rotate / schedule) uses only Node built-ins.
 * S3 upload (`@aws-sdk/client-s3`), PostgreSQL dumps (`pg_dump`) and the
 * SQLite online-backup API (`better-sqlite3`) are loaded lazily and only when
 * actually configured, so the module — and its tests — run with zero extra
 * dependencies.
 *
 * Usage:
 *   node backup.js                 # create + verify + (optional S3) + rotate
 *   node backup.js --list          # list local backups, newest last
 *   node backup.js --verify-latest # re-verify the most recent backup
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
  createWriteStream,
  rmSync,
} from 'fs';
import { gzipSync, gunzipSync } from 'zlib';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Logging ─────────────────────────────────────────────────────────────────
const consoleLog = {
  info: (m) => console.log(`[backup] ${m}`),
  warn: (m) => console.warn(`[backup] ${m}`),
  error: (m) => console.error(`[backup] ${m}`),
};
const silentLog = { info() {}, warn() {}, error() {} };

// ── Config ──────────────────────────────────────────────────────────────────
function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function isPostgres(url) {
  return typeof url === 'string' && /^postgres(ql)?:\/\//.test(url);
}

/**
 * Build the backup configuration from environment variables, applying the same
 * defaults the rest of the backend uses for data-file and database locations.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadBackupConfig(env = process.env) {
  const backendDir = __dirname;

  const dataFiles = (
    env.BACKUP_DATA_FILES
      ? env.BACKUP_DATA_FILES.split(',').map((s) => s.trim()).filter(Boolean)
      : [env.DATA_FILE || 'data.json', env.WEBHOOK_DATA_FILE || 'webhooks.json']
  ).map((f) => (isAbsolute(f) ? f : join(backendDir, f)));

  return {
    backendDir,
    backupDir: env.BACKUP_DIR ? resolve(env.BACKUP_DIR) : join(backendDir, 'backups'),
    dataFiles,
    databaseUrl: env.DATABASE_URL || './dev.db',
    retentionDays: toInt(env.BACKUP_RETENTION_DAYS, 7),
    retentionMax: toInt(env.BACKUP_RETENTION_MAX, 30),
    s3: env.BACKUP_S3_BUCKET
      ? {
          bucket: env.BACKUP_S3_BUCKET,
          prefix: (env.BACKUP_S3_PREFIX || 'backups').replace(/\/+$/, ''),
          region: env.BACKUP_S3_REGION || env.AWS_REGION || 'us-east-1',
          endpoint: env.BACKUP_S3_ENDPOINT || undefined,
        }
      : null,
  };
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────
// Backup names embed an ISO timestamp with ':' and '.' replaced by '-' so they
// are valid on every filesystem, e.g. backup-2026-06-30T03-00-00-000Z.
function stampFromDate(d) {
  return d.toISOString().replace(/[:.]/g, '-');
}

export function parseBackupTimestamp(name) {
  const s = name.replace(/^backup-/, '');
  const iso = s.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

// ── Member helpers ────────────────────────────────────────────────────────────
/**
 * Gzip `src` into `dest`, returning the SHA-256 of the *original* bytes plus
 * sizes. The checksum is over the uncompressed content so verification also
 * proves the gzip round-trips to the exact source.
 */
function gzipFileInto(src, dest) {
  const raw = readFileSync(src);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const gz = gzipSync(raw);
  writeFileSync(dest, gz);
  return { sha256, originalBytes: raw.length, gzipBytes: gz.length };
}

// ── Database snapshots ────────────────────────────────────────────────────────
function pgDump(url, dest, log) {
  return new Promise((resolvePromise, reject) => {
    const out = createWriteStream(dest);
    const proc = spawn('pg_dump', ['--no-owner', '--no-privileges', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stdout.pipe(out);
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) =>
      reject(new Error(`pg_dump failed to start: ${err.message}. Is the PostgreSQL client installed?`))
    );
    proc.on('close', (code) => {
      if (code === 0) {
        log.info('pg_dump completed');
        resolvePromise();
      } else {
        reject(new Error(`pg_dump exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

async function sqliteSnapshot(src, dest, log) {
  // Prefer better-sqlite3's online backup API for a consistent snapshot of a
  // live database; fall back to a plain file copy if it is unavailable.
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(src, { readonly: true, fileMustExist: true });
    try {
      await db.backup(dest);
    } finally {
      db.close();
    }
    log.info('sqlite online backup completed');
  } catch (err) {
    log.warn(`sqlite online backup unavailable (${err.message}); copying file instead`);
    copyFileSync(src, dest);
  }
}

async function backupDatabase(config, dir, log) {
  const url = config.databaseUrl;

  if (isPostgres(url)) {
    const sqlPath = join(dir, 'database.sql');
    await pgDump(url, sqlPath, log);
    const member = gzipFileInto(sqlPath, join(dir, 'database.sql.gz'));
    rmSync(sqlPath, { force: true });
    return { name: 'database.sql.gz', source: 'database.sql', engine: 'postgres', ...member };
  }

  const file = isAbsolute(url) ? url : join(config.backendDir, url);
  if (!existsSync(file)) {
    log.info(`skip database (no SQLite file at ${file})`);
    return null;
  }
  const snapshot = join(dir, 'database.sqlite');
  await sqliteSnapshot(file, snapshot, log);
  const member = gzipFileInto(snapshot, join(dir, 'database.sqlite.gz'));
  rmSync(snapshot, { force: true });
  return { name: 'database.sqlite.gz', source: 'database.sqlite', engine: 'sqlite', ...member };
}

// ── Create ────────────────────────────────────────────────────────────────────
/**
 * Create a single backup directory containing gzipped members + manifest.
 * Throws if no data source exists, so an empty backup is never recorded.
 *
 * @param {ReturnType<typeof loadBackupConfig>} config
 * @param {{ now?: Date, log?: typeof consoleLog }} [opts]
 */
export async function createBackup(config, { now = new Date(), log = silentLog } = {}) {
  const name = `backup-${stampFromDate(now)}`;
  const dir = join(config.backupDir, name);
  mkdirSync(dir, { recursive: true });

  const members = [];

  for (const file of config.dataFiles) {
    if (!existsSync(file)) {
      log.info(`skip data file (missing): ${file}`);
      continue;
    }
    const base = basename(file);
    const member = gzipFileInto(file, join(dir, `${base}.gz`));
    members.push({ name: `${base}.gz`, source: base, engine: 'json', ...member });
  }

  const dbMember = await backupDatabase(config, dir, log);
  if (dbMember) members.push(dbMember);

  if (members.length === 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('No data sources found to back up');
  }

  const manifest = { name, version: 1, createdAt: now.toISOString(), members };
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return { name, dir, manifestPath, manifest };
}

// ── Verify ────────────────────────────────────────────────────────────────────
/**
 * Verify a backup directory: every member must exist, gunzip cleanly, and
 * match the SHA-256 recorded in the manifest.
 *
 * @param {string} dir Path to a `backup-<timestamp>` directory.
 */
export async function verifyBackup(dir) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`manifest.json not found in ${dir}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const results = (manifest.members || []).map((m) => {
    const p = join(dir, m.name);
    if (!existsSync(p)) return { name: m.name, ok: false, error: 'missing' };
    try {
      const raw = gunzipSync(readFileSync(p));
      const sha = createHash('sha256').update(raw).digest('hex');
      return sha === m.sha256
        ? { name: m.name, ok: true, error: null }
        : { name: m.name, ok: false, error: 'checksum mismatch' };
    } catch (err) {
      return { name: m.name, ok: false, error: `corrupt gzip: ${err.message}` };
    }
  });

  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}

// ── List & rotate ─────────────────────────────────────────────────────────────
/**
 * List local backups sorted oldest → newest.
 *
 * @param {ReturnType<typeof loadBackupConfig>} config
 */
export function listBackups(config) {
  if (!existsSync(config.backupDir)) return [];
  return readdirSync(config.backupDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('backup-'))
    .map((d) => ({
      name: d.name,
      dir: join(config.backupDir, d.name),
      createdAt: parseBackupTimestamp(d.name),
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Decide which backups violate the retention policy. Pure function — no I/O —
 * so the rotation rules can be unit-tested directly.
 *
 * A backup is expired if it is older than `retentionDays`, OR if keeping it
 * would exceed `retentionMax` (the oldest surviving ones are dropped first).
 * Setting either limit to 0 disables that rule.
 *
 * @param {Array<{name:string, dir?:string, createdAt:Date}>} backups
 * @param {{retentionDays:number, retentionMax:number}} policy
 * @param {Date} [now]
 */
export function selectExpired(backups, { retentionDays, retentionMax }, now = new Date()) {
  const sorted = [...backups].sort((a, b) => a.createdAt - b.createdAt);
  const expired = new Set();

  if (retentionDays > 0) {
    const cutoff = now.getTime() - retentionDays * 86400000;
    for (const b of sorted) if (b.createdAt.getTime() < cutoff) expired.add(b.name);
  }

  const survivors = sorted.filter((b) => !expired.has(b.name));
  if (retentionMax > 0 && survivors.length > retentionMax) {
    for (const b of survivors.slice(0, survivors.length - retentionMax)) expired.add(b.name);
  }

  return sorted.filter((b) => expired.has(b.name));
}

/**
 * Delete expired local backups per the retention policy.
 *
 * @returns {string[]} names of removed backups
 */
export function rotateBackups(config, now = new Date(), log = silentLog) {
  const expired = selectExpired(listBackups(config), config, now);
  for (const b of expired) {
    rmSync(b.dir, { recursive: true, force: true });
    log.info(`rotated out: ${b.name}`);
  }
  return expired.map((b) => b.name);
}

// ── S3 (second location for disaster recovery) ─────────────────────────────────
async function loadS3() {
  try {
    return await import('@aws-sdk/client-s3');
  } catch {
    throw new Error(
      'BACKUP_S3_BUCKET is set but @aws-sdk/client-s3 is not installed. Run: npm install @aws-sdk/client-s3'
    );
  }
}

function makeS3Client(S3Client, s3) {
  return new S3Client({
    region: s3.region,
    ...(s3.endpoint ? { endpoint: s3.endpoint, forcePathStyle: true } : {}),
  });
}

/**
 * Upload every file of a backup directory to S3 under `<prefix>/<name>/`.
 * Returns the uploaded object keys, or null if S3 is not configured.
 */
export async function uploadBackupToS3(backupDir, config, log = silentLog) {
  if (!config.s3) return null;
  const { S3Client, PutObjectCommand } = await loadS3();
  const client = makeS3Client(S3Client, config.s3);

  const name = basename(backupDir);
  const uploaded = [];
  for (const f of readdirSync(backupDir)) {
    const Key = `${config.s3.prefix}/${name}/${f}`;
    await client.send(
      new PutObjectCommand({ Bucket: config.s3.bucket, Key, Body: readFileSync(join(backupDir, f)) })
    );
    uploaded.push(Key);
    log.info(`uploaded s3://${config.s3.bucket}/${Key}`);
  }
  return uploaded;
}

/**
 * Apply the same retention policy to backups stored in S3.
 *
 * @returns {string[]} names of removed S3 backups
 */
export async function rotateS3Backups(config, now = new Date(), log = silentLog) {
  if (!config.s3) return [];
  const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = await loadS3();
  const client = makeS3Client(S3Client, config.s3);

  // Discover backup names from object keys: <prefix>/<backup-name>/<file>.
  const names = new Map();
  let ContinuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: config.s3.bucket,
        Prefix: `${config.s3.prefix}/`,
        ContinuationToken,
      })
    );
    for (const obj of page.Contents || []) {
      const rest = obj.Key.slice(config.s3.prefix.length + 1);
      const backupName = rest.split('/')[0];
      if (!backupName.startsWith('backup-')) continue;
      if (!names.has(backupName)) {
        names.set(backupName, { name: backupName, createdAt: parseBackupTimestamp(backupName), keys: [] });
      }
      names.get(backupName).keys.push(obj.Key);
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);

  const expired = selectExpired([...names.values()], config, now);
  for (const b of expired) {
    for (const Key of names.get(b.name).keys) {
      await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key }));
    }
    log.info(`rotated out (s3): ${b.name}`);
  }
  return expired.map((b) => b.name);
}

// ── Orchestration ──────────────────────────────────────────────────────────────
/**
 * Full backup run: create → verify → upload to S3 (if configured) → rotate
 * both local and remote copies. Throws if creation or verification fails so a
 * scheduled job / CI step exits non-zero on a bad backup.
 */
export async function runBackup(config = loadBackupConfig(), { now = new Date(), log = consoleLog } = {}) {
  log.info('starting backup run');
  const { name, dir } = await createBackup(config, { now, log });
  log.info(`created backup: ${name}`);

  const verification = await verifyBackup(dir);
  if (!verification.ok) {
    const failed = verification.results.filter((r) => !r.ok).map((r) => `${r.name} (${r.error})`);
    throw new Error(`backup verification failed: ${failed.join(', ')}`);
  }
  log.info(`verification passed (${verification.results.length} member(s))`);

  let s3 = null;
  if (config.s3) {
    s3 = await uploadBackupToS3(dir, config, log);
    await rotateS3Backups(config, now, log);
  }

  const rotated = rotateBackups(config, now, log);
  log.info(`rotation removed ${rotated.length} old backup(s)`);

  return { name, dir, verification, s3, rotated };
}

// ── In-process scheduler (optional, dependency-free) ───────────────────────────
/**
 * Start a recurring in-process backup job when BACKUP_ENABLED=true. Runs every
 * BACKUP_INTERVAL_HOURS (default 24). Returns the timer handle, or null when
 * disabled. The timer is unref'd so it never keeps the process alive on its own.
 *
 * For production, an external scheduler (system cron or the GitHub Actions
 * workflow in .github/workflows/backup.yml) is recommended — see docs/backups.md.
 */
export function startBackupScheduler({ log = consoleLog } = {}) {
  if (process.env.BACKUP_ENABLED !== 'true') return null;
  const hours = Math.max(1, toInt(process.env.BACKUP_INTERVAL_HOURS, 24));
  log.info(`backup scheduler enabled: every ${hours}h`);

  const tick = () => {
    runBackup(loadBackupConfig(), { log }).catch((err) =>
      log.error(`scheduled backup failed: ${err.message}`)
    );
  };

  const timer = setInterval(tick, hours * 3600 * 1000);
  timer.unref?.();
  return timer;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const config = loadBackupConfig();

  const main = async () => {
    if (args.includes('--list')) {
      const backups = listBackups(config);
      if (backups.length === 0) {
        consoleLog.info('no local backups found');
        return;
      }
      for (const b of backups) consoleLog.info(`${b.name}  (${b.createdAt.toISOString()})`);
      return;
    }

    if (args.includes('--verify-latest')) {
      const backups = listBackups(config);
      if (backups.length === 0) throw new Error('no local backups to verify');
      const latest = backups[backups.length - 1];
      const v = await verifyBackup(latest.dir);
      consoleLog.info(`${latest.name}: ${v.ok ? 'OK' : 'FAILED'}`);
      if (!v.ok) throw new Error(JSON.stringify(v.results));
      return;
    }

    await runBackup(config, { log: consoleLog });
  };

  main()
    .then(() => process.exit(0))
    .catch((err) => {
      consoleLog.error(err.message);
      process.exit(1);
    });
}
