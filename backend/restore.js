/**
 * Restore a backup produced by backup.js.
 *
 * Restoring verifies the backup first (refusing a corrupt one unless --force),
 * then writes each member back to its original location:
 *   - JSON data files  → backend/<source>
 *   - SQLite database  → the DATABASE_URL path (or backend/database.sqlite)
 *   - PostgreSQL dump  → written to disk; restore is NOT run automatically.
 *     A PostgreSQL restore overwrites a live database, so the dump is left for
 *     you to apply with: psql "$DATABASE_URL" < restore-database.sql
 *
 * Any file that would be overwritten is first moved aside to `<file>.pre-restore`
 * so a mistaken restore is always reversible.
 *
 * Usage:
 *   node restore.js --list                 # list available backups
 *   node restore.js <backup-name>          # restore a local backup
 *   node restore.js --from-s3 <name>       # download from S3, then restore
 *   node restore.js <backup-name> --force  # restore even if verification fails
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { basename, dirname, isAbsolute, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { listBackups, loadBackupConfig, verifyBackup } from './backup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const consoleLog = {
  info: (m) => console.log(`[restore] ${m}`),
  warn: (m) => console.warn(`[restore] ${m}`),
  error: (m) => console.error(`[restore] ${m}`),
};
const silentLog = { info() {}, warn() {}, error() {} };

function isPostgres(url) {
  return typeof url === 'string' && /^postgres(ql)?:\/\//.test(url);
}

function moveAside(target, log) {
  if (existsSync(target)) {
    const aside = `${target}.pre-restore`;
    renameSync(target, aside);
    log.info(`existing file preserved at ${aside}`);
  }
}

function sqliteTarget(config) {
  const url = config.databaseUrl;
  if (isPostgres(url)) return join(config.backendDir, 'database.sqlite');
  return isAbsolute(url) ? url : join(config.backendDir, url);
}

/**
 * Restore a single backup directory into place.
 *
 * @param {string} name Backup name, e.g. "backup-2026-06-30T03-00-00-000Z".
 * @param {{ config?: ReturnType<typeof loadBackupConfig>, log?: typeof consoleLog, force?: boolean }} [opts]
 * @returns {Promise<string[]>} paths written
 */
export async function restoreBackup(
  name,
  { config = loadBackupConfig(), log = consoleLog, force = false } = {},
) {
  const dir = join(config.backupDir, name);
  if (!existsSync(dir)) throw new Error(`backup not found: ${dir}`);

  const verification = await verifyBackup(dir);
  if (!verification.ok && !force) {
    const failed = verification.results.filter((r) => !r.ok).map((r) => `${r.name} (${r.error})`);
    throw new Error(
      `backup failed verification: ${failed.join(', ')}. Re-run with --force to override.`,
    );
  }
  if (!verification.ok) log.warn('verification failed but --force was given; continuing');

  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  const written = [];

  for (const m of manifest.members) {
    const raw = gunzipSync(readFileSync(join(dir, m.name)));

    if (m.engine === 'postgres') {
      const out = join(config.backendDir, 'restore-database.sql');
      writeFileSync(out, raw);
      log.warn(`PostgreSQL dump written to ${out}`);
      log.warn(`To apply it (this OVERWRITES the database): psql "$DATABASE_URL" < ${out}`);
      written.push(out);
      continue;
    }

    let target;
    if (m.engine === 'sqlite') {
      target = sqliteTarget(config);
    } else {
      // JSON data file — restore next to the backend by its original basename.
      target = join(config.backendDir, basename(m.source));
    }

    mkdirSync(dirname(target), { recursive: true });
    moveAside(target, log);
    writeFileSync(target, raw);
    log.info(`restored ${m.name} → ${target}`);
    written.push(target);
  }

  return written;
}

// ── S3 download ────────────────────────────────────────────────────────────────
/**
 * Download a backup's objects from S3 into the local backup directory so it can
 * be restored. Returns the local directory path.
 */
export async function downloadBackupFromS3(name, config = loadBackupConfig(), log = consoleLog) {
  if (!config.s3) throw new Error('S3 is not configured (set BACKUP_S3_BUCKET)');
  let s3mod;
  try {
    s3mod = await import('@aws-sdk/client-s3');
  } catch {
    throw new Error('@aws-sdk/client-s3 is not installed. Run: npm install @aws-sdk/client-s3');
  }
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = s3mod;
  const client = new S3Client({
    region: config.s3.region,
    ...(config.s3.endpoint ? { endpoint: config.s3.endpoint, forcePathStyle: true } : {}),
  });

  const prefix = `${config.s3.prefix}/${name}/`;
  const localDir = join(config.backupDir, name);
  mkdirSync(localDir, { recursive: true });

  let ContinuationToken;
  let count = 0;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: config.s3.bucket, Prefix: prefix, ContinuationToken }),
    );
    for (const obj of page.Contents || []) {
      const file = obj.Key.slice(prefix.length);
      if (!file) continue;
      const res = await client.send(
        new GetObjectCommand({ Bucket: config.s3.bucket, Key: obj.Key }),
      );
      const bytes = Buffer.from(await res.Body.transformToByteArray());
      writeFileSync(join(localDir, file), bytes);
      count += 1;
      log.info(`downloaded ${obj.Key}`);
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);

  if (count === 0) throw new Error(`no objects found in s3://${config.s3.bucket}/${prefix}`);
  return localDir;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const config = loadBackupConfig();
  const force = args.includes('--force');

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

    const fromS3Idx = args.indexOf('--from-s3');
    let name;
    if (fromS3Idx !== -1) {
      name = args[fromS3Idx + 1];
      if (!name) throw new Error('--from-s3 requires a backup name');
      await downloadBackupFromS3(name, config, consoleLog);
    } else {
      name = args.find((a) => a.startsWith('backup-'));
      if (!name)
        throw new Error('usage: node restore.js <backup-name> | --from-s3 <name> | --list');
    }

    const written = await restoreBackup(name, { config, log: consoleLog, force });
    consoleLog.info(`restore complete: ${written.length} file(s)`);
  };

  main()
    .then(() => process.exit(0))
    .catch((err) => {
      consoleLog.error(err.message);
      process.exit(1);
    });
}

export { consoleLog as restoreLogger, silentLog };
