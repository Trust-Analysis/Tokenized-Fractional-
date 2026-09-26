#!/usr/bin/env node
// Dependency audit ratchet for the npm workspaces — issue #721.
//
// Runs `npm audit` in every npm project and fails on high/critical findings that
// are NOT already recorded in .github/dependency-audit-baseline.json. Also fails
// when the baseline contains entries that no longer reproduce, so the accepted
// list can only shrink and must be re-verified whenever it is edited.
//
// Usage:
//   node scripts/check-dependency-audit.mjs            # enforce (CI)
//   node scripts/check-dependency-audit.mjs --update   # rewrite the baseline
//
// Why a baseline instead of a plain `npm audit --audit-level=high` gate: the
// repository already carries high/critical findings, so an ungated check would
// be red on arrival and would block every merge until the whole backlog was
// cleared in one change. See CONTRIBUTING.md ("Dependency vulnerability
// triage") for the remediation order and the exception policy.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(REPO_ROOT, '.github', 'dependency-audit-baseline.json');

// Must match the `directories:` in .github/dependabot.yml. The four
// backend/services/* packages and backend/gateway are intentionally absent:
// they have no committed lockfile, so neither `npm audit` nor Dependabot can
// resolve their dependency trees.
const NPM_PROJECTS = ['.', '/backend', '/frontend', '/sdk', '/load-test'];

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const UPDATE = process.argv.includes('--update');

/**
 * Resolve how to invoke npm without a shell.
 *
 * Node (>=18.20.2, the CVE-2024-27980 fix) refuses to spawn `npm`/`npm.cmd`
 * through `shell: true` without extra escaping, and refuses `npm.cmd` outright
 * with `shell: false` (EINVAL). So instead of going through a shell, we run
 * npm's own entry point with the current Node binary. That keeps the child
 * process free of shell quoting entirely and is identical on Linux CI and on
 * contributor machines.
 */
function resolveNpm() {
  const execDir = dirname(process.execPath);
  const candidates = [];

  // Set when this script is itself run from an npm script.
  if (process.env.npm_execpath && basename(process.env.npm_execpath) === 'npm-cli.js') {
    candidates.push(process.env.npm_execpath);
  }
  // Windows layout: <node dir>/node_modules/npm/bin/npm-cli.js
  candidates.push(join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  // POSIX layout: <prefix>/bin/node -> <prefix>/lib/node_modules/npm/bin/npm-cli.js
  candidates.push(join(execDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  candidates.push(join(execDir, '..', 'share', 'npm', 'bin', 'npm-cli.js'));

  for (const cli of candidates) {
    if (existsSync(cli)) return { bin: process.execPath, prefix: [cli], cli };
  }

  // Last resort for unusual layouts: shell spawn, accepting the deprecation warning.
  return { bin: 'npm', prefix: [], cli: null };
}

const NPM = resolveNpm();

// ---------------------------------------------------------------------------
// npm audit
// ---------------------------------------------------------------------------

/** Stable identity for one finding: which package, in which project, from which advisories. */
function findingKey(project, name, via) {
  const ids = [];
  for (const entry of via) {
    if (typeof entry === 'string') { ids.push(`via:${entry}`); continue; }
    const url = entry.url || '';
    const id = url.split('/').filter(Boolean).pop();
    ids.push(id || `source:${entry.source ?? '?'}`);
  }
  return `${project}::${name}::${[...new Set(ids)].sort().join('+')}`;
}

function auditProject(project) {
  const cwd = join(REPO_ROOT, project);
  if (!existsSync(join(cwd, 'package-lock.json'))) {
    throw new Error(`${project}: no package-lock.json, cannot audit`);
  }

  // npm audit exits 1 when it finds vulnerabilities, so a non-zero status is
  // expected and must not be treated as a crash. Only a missing/unparseable
  // JSON payload means the audit itself did not run (e.g. registry outage).
  const res = spawnSync(NPM.bin, [...NPM.prefix, 'audit', '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: NPM.cli === null && process.platform === 'win32',
  });
  const stdout = res.stdout || '';
  const start = stdout.indexOf('{');
  if (start < 0) {
    throw new Error(
      `${project}: npm audit produced no JSON (exit ${res.status}). ${(res.stderr || '').trim().slice(0, 200)}`
    );
  }

  let report;
  try {
    report = JSON.parse(stdout.slice(start));
  } catch {
    throw new Error(`${project}: could not parse npm audit JSON`);
  }

  const findings = {};
  for (const [name, v] of Object.entries(report.vulnerabilities || {})) {
    if (!BLOCKING_SEVERITIES.has(v.severity)) continue;
    const key = findingKey(project, name, v.via || []);
    const fixAvailable = v.fixAvailable;
    findings[key] = {
      severity: v.severity,
      project,
      package: name,
      direct: Boolean(v.isDirect),
      fix: fixAvailable === false || fixAvailable == null
        ? null
        : fixAvailable === true
          ? 'in-range'
          : `upgrade-to ${fixAvailable.name}@${fixAvailable.version}`,
    };
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Compare against the baseline
// ---------------------------------------------------------------------------

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { schema: 1, findings: {} };
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

const ghUrl = (repo, file) => `https://github.com/${repo}/blob/${file}`;

let current = {};
for (const project of NPM_PROJECTS) {
  let findings;
  try {
    findings = auditProject(project);
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(2);
  }
  current = { ...current, ...findings };
  const n = Object.keys(findings).length;
  console.log(`  ${project.padEnd(14)} ${n} high/critical`);
}

const baseline = loadBaseline();
const accepted = baseline.findings || {};

if (UPDATE) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        schema: 1,
        note:
          'Accepted pre-existing high/critical npm findings. Enforced as a ratchet by ' +
          'scripts/check-dependency-audit.mjs: new entries are rejected, and stale entries ' +
          '(no longer reproducible) also fail so this list can only shrink. ' +
          'Regenerate with: node scripts/check-dependency-audit.mjs --update',
        findings: Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))),
      },
      null,
      2
    ) + '\n'
  );
  console.log(`\nBaseline rewritten: ${Object.keys(current).length} accepted finding(s).`);
  console.log('Review the diff before committing — it is the record of what is knowingly unfixed.');
  process.exit(0);
}

const newKeys = Object.keys(current).filter((k) => !(k in accepted)).sort();
const staleKeys = Object.keys(accepted).filter((k) => !(k in current)).sort();

if (newKeys.length) {
  console.error(`\n::error::${newKeys.length} new high/critical dependency finding(s) not in the baseline:`);
  for (const k of newKeys) {
    const f = current[k];
    console.error(`::error file=${f.project} — ${f.package} (${f.severity}${f.direct ? ', direct' : ''}, fix: ${f.fix ?? 'none available'})`);
  }
  console.error(`\nFix them, or if a finding genuinely cannot be remediated right now, follow the`);
  console.error(`exception process in CONTRIBUTING.md and add it deliberately:`);
  console.error(`  node scripts/check-dependency-audit.mjs --update`);
}

if (staleKeys.length) {
  console.error(`\n::error::${staleKeys.length} baseline entry/entries no longer reproduce and must be removed:`);
  for (const k of staleKeys) {
    const f = accepted[k];
    console.error(`::error file=${f?.project ?? '?'} — ${f?.package ?? '?'} (${f?.severity ?? '?'})`);
  }
  console.error(`\nThese are fixed. Prune them so the baseline reflects reality:`);
  console.error(`  node scripts/check-dependency-audit.mjs --update`);
}

const total = Object.keys(current).length;
console.log(`\n${total} high/critical finding(s); ${Object.keys(accepted).length} accepted in the baseline.`);

if (newKeys.length || staleKeys.length) process.exit(1);

console.log('No new high/critical dependency findings.');
console.log(`Baseline: ${ghUrl('Trust-Analysis/Tokenized-Fractional-', 'main/.github/dependency-audit-baseline.json')}`);
