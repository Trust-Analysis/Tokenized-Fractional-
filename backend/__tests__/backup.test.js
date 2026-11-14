process.env.NODE_ENV = 'test';

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import {
  loadBackupConfig,
  createBackup,
  verifyBackup,
  listBackups,
  selectExpired,
  rotateBackups,
  parseBackupTimestamp,
} from '../backup.js';
import { restoreBackup } from '../restore.js';

let root;

function makeConfig(overrides = {}) {
  return {
    backendDir: root,
    backupDir: join(root, 'backups'),
    dataFiles: [join(root, 'data.json'), join(root, 'webhooks.json')],
    databaseUrl: './does-not-exist.db', // no SQLite file → db source skipped
    retentionDays: 7,
    retentionMax: 30,
    s3: null,
    ...overrides,
  };
}

function entry(name) {
  return { name, dir: `/x/${name}`, createdAt: parseBackupTimestamp(name) };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'backup-test-'));
  writeFileSync(join(root, 'data.json'), JSON.stringify({ asset: 1 }));
  writeFileSync(join(root, 'webhooks.json'), JSON.stringify({ hook: 2 }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── Config ────────────────────────────────────────────────────────────────────
describe('loadBackupConfig', () => {
  test('applies sane defaults', () => {
    const cfg = loadBackupConfig({});
    expect(cfg.retentionDays).toBe(7);
    expect(cfg.retentionMax).toBe(30);
    expect(cfg.s3).toBeNull();
    expect(cfg.dataFiles.some((f) => f.endsWith('data.json'))).toBe(true);
    expect(cfg.dataFiles.some((f) => f.endsWith('webhooks.json'))).toBe(true);
  });

  test('parses S3 config when bucket is set', () => {
    const cfg = loadBackupConfig({ BACKUP_S3_BUCKET: 'b', BACKUP_S3_PREFIX: 'p/', BACKUP_S3_REGION: 'eu-west-1' });
    expect(cfg.s3).toEqual({ bucket: 'b', prefix: 'p', region: 'eu-west-1', endpoint: undefined });
  });
});

// ── Create + verify ─────────────────────────────────────────────────────────────
describe('createBackup / verifyBackup', () => {
  test('creates gzipped members + manifest and verifies clean', async () => {
    const cfg = makeConfig();
    const { dir, manifest } = await createBackup(cfg, { now: new Date('2026-06-30T03:00:00.000Z') });

    expect(existsSync(join(dir, 'data.json.gz'))).toBe(true);
    expect(existsSync(join(dir, 'webhooks.json.gz'))).toBe(true);
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
    expect(manifest.members).toHaveLength(2);

    const v = await verifyBackup(dir);
    expect(v.ok).toBe(true);
    expect(v.results.every((r) => r.ok)).toBe(true);

    // gzip member round-trips to original bytes
    const restored = JSON.parse(gunzipSync(readFileSync(join(dir, 'data.json.gz'))));
    expect(restored).toEqual({ asset: 1 });
  });

  test('verification fails when a member is tampered with', async () => {
    const cfg = makeConfig();
    const { dir } = await createBackup(cfg, { now: new Date('2026-06-30T03:00:00.000Z') });

    writeFileSync(join(dir, 'data.json.gz'), Buffer.from('not gzip'));
    const v = await verifyBackup(dir);
    expect(v.ok).toBe(false);
    expect(v.results.find((r) => r.name === 'data.json.gz').ok).toBe(false);
  });

  test('throws when no data source exists', async () => {
    const cfg = makeConfig({ dataFiles: [join(root, 'nope.json')] });
    await expect(createBackup(cfg, {})).rejects.toThrow(/No data sources/);
  });
});

// ── Retention selection (pure) ───────────────────────────────────────────────────
describe('selectExpired', () => {
  test('expires backups older than retentionDays', () => {
    const backups = [
      entry('backup-2026-06-01T03-00-00-000Z'), // ~29 days old
      entry('backup-2026-06-29T03-00-00-000Z'), // 1 day old
    ];
    const now = new Date('2026-06-30T03:00:00.000Z');
    const expired = selectExpired(backups, { retentionDays: 7, retentionMax: 0 }, now);
    expect(expired.map((b) => b.name)).toEqual(['backup-2026-06-01T03-00-00-000Z']);
  });

  test('caps total count, dropping oldest first', () => {
    const backups = [
      entry('backup-2026-06-28T03-00-00-000Z'),
      entry('backup-2026-06-29T03-00-00-000Z'),
      entry('backup-2026-06-30T03-00-00-000Z'),
    ];
    const now = new Date('2026-06-30T04:00:00.000Z');
    const expired = selectExpired(backups, { retentionDays: 0, retentionMax: 2 }, now);
    expect(expired.map((b) => b.name)).toEqual(['backup-2026-06-28T03-00-00-000Z']);
  });

  test('retains everything when both limits are 0', () => {
    const backups = [entry('backup-2020-01-01T00-00-00-000Z')];
    const expired = selectExpired(backups, { retentionDays: 0, retentionMax: 0 }, new Date());
    expect(expired).toHaveLength(0);
  });
});

// ── Rotation (I/O) ──────────────────────────────────────────────────────────────
describe('rotateBackups', () => {
  test('deletes expired backup directories', async () => {
    const cfg = makeConfig({ retentionDays: 0, retentionMax: 1 });
    mkdirSync(cfg.backupDir, { recursive: true });
    for (const name of ['backup-2026-06-28T03-00-00-000Z', 'backup-2026-06-30T03-00-00-000Z']) {
      const d = join(cfg.backupDir, name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'manifest.json'), '{}');
    }

    const removed = rotateBackups(cfg, new Date('2026-06-30T04:00:00.000Z'));
    expect(removed).toEqual(['backup-2026-06-28T03-00-00-000Z']);
    expect(listBackups(cfg).map((b) => b.name)).toEqual(['backup-2026-06-30T03-00-00-000Z']);
  });
});

// ── Restore ─────────────────────────────────────────────────────────────────────
describe('restoreBackup', () => {
  test('restores data files, preserving the current copy', async () => {
    const cfg = makeConfig();
    const { name } = await createBackup(cfg, { now: new Date('2026-06-30T03:00:00.000Z') });

    // Mutate live data, then restore
    writeFileSync(join(root, 'data.json'), JSON.stringify({ asset: 999 }));
    const written = await restoreBackup(name, { config: cfg, log: { info() {}, warn() {}, error() {} } });

    expect(JSON.parse(readFileSync(join(root, 'data.json'), 'utf-8'))).toEqual({ asset: 1 });
    expect(existsSync(join(root, 'data.json.pre-restore'))).toBe(true);
    expect(written.some((p) => p.endsWith('data.json'))).toBe(true);
  });

  test('refuses a corrupt backup unless forced', async () => {
    const cfg = makeConfig();
    const { name, dir } = await createBackup(cfg, { now: new Date('2026-06-30T03:00:00.000Z') });
    writeFileSync(join(dir, 'data.json.gz'), Buffer.from('corrupt'));

    await expect(restoreBackup(name, { config: cfg, log: { info() {}, warn() {}, error() {} } })).rejects.toThrow(
      /failed verification/
    );
  });
});
