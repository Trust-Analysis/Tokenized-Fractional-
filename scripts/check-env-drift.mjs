#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const allowlistPath = path.join(ROOT, 'scripts', 'env-drift-allowlist.json');
const allowlist = fs.existsSync(allowlistPath)
  ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  : {};

const ignoreCode = new Set(allowlist.ignoreInCode || []);
const ignoreManifest = new Set(allowlist.ignoreInDocsOrManifests || []);
const allowUnused = new Set(allowlist.allowUnusedInManifests || []);
const allowUndoc = new Set(allowlist.allowUndocumentedInCode || []);

const CODE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
]);

function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, pred, out);
    else if (pred(full)) out.push(full);
  }
  return out;
}

function fromCode(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const set = new Set();
  for (const re of [
    /\bprocess\.env\.([A-Z][A-Z0-9_]*)/g,
    /\bprocess\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
    /\bimport\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
    /\bimport\.meta\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  ]) {
    for (const m of txt.matchAll(re)) {
      if (!ignoreCode.has(m[1])) set.add(m[1]);
    }
  }
  return set;
}

function fromEnvExample(filePath) {
  const set = new Set();
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=/);
    if (m && !ignoreManifest.has(m[1])) set.add(m[1]);
  }
  return set;
}

function fromManifest(filePath) {
  const set = new Set();
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const k = line.match(/^(?:-\s*)?([A-Z][A-Z0-9_]*)\s*:/);
    if (k && !ignoreManifest.has(k[1])) set.add(k[1]);
    for (const m of line.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-|:-?|\})/g)) {
      if (!ignoreManifest.has(m[1])) set.add(m[1]);
    }
  }
  return set;
}

const codeFiles = walk(ROOT, (f) => {
  if (!CODE_EXTS.has(path.extname(f))) return false;
  if (/\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f)) return false;
  return !f.split(path.sep).includes('scripts');
});

const usedInCode = new Set();
for (const f of codeFiles) {
  for (const v of fromCode(f)) usedInCode.add(v);
}

const envFiles = walk(ROOT, (f) => path.basename(f) === '.env.example');
const composeFiles = walk(ROOT, (f) => /compose.*\.ya?ml$/i.test(path.basename(f)));
const configMaps = walk(ROOT, (f) => {
  const b = path.basename(f);
  return b.includes('configmap') && /\.ya?ml$/i.test(b);
});

const documented = new Set();
for (const f of envFiles) for (const v of fromEnvExample(f)) documented.add(v);
for (const f of [...composeFiles, ...configMaps]) {
  for (const v of fromManifest(f)) documented.add(v);
}

const undocumented = [...usedInCode].filter((v) => !documented.has(v) && !allowUndoc.has(v)).sort();
const unused = [...documented].filter((v) => !usedInCode.has(v) && !allowUnused.has(v)).sort();

console.log(
  `Code vars: ${usedInCode.size}, Manifest vars: ${documented.size}, Undocumented: ${undocumented.length}, Unused: ${unused.length}`,
);

if (undocumented.length) {
  console.error('Undocumented in code:', undocumented.join(', '));
}
if (unused.length) {
  console.error('Unused in manifests:', unused.join(', '));
}
if (undocumented.length || unused.length) {
  process.exit(1);
}
console.log('No environment variable drift detected.');
