#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const distDir = join(projectRoot, 'dist');
const failOnExceed = process.env.VITE_PERF_BUDGET_FAIL === 'true';

const budgets = {
  initialJsKb: 250,
  chunkJsKb: 500,
  cssKb: 50,
};

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return [fullPath];
  });
}

function formatKb(bytes) {
  return (bytes / 1024).toFixed(1);
}

function getAssetFiles() {
  if (!statSync(distDir, { throwIfNoEntry: false })?.isDirectory?.()) {
    return [];
  }
  return walk(distDir).filter((file) => ['.js', '.css'].includes(extname(file)));
}

const files = getAssetFiles();
const violations = [];

for (const file of files) {
  const sizeBytes = statSync(file).size;
  const sizeKb = sizeBytes / 1024;
  const ext = extname(file).toLowerCase();

  if (ext === '.js') {
    const budget = file.includes('/assets/index') || file.endsWith('/index.js')
      ? budgets.initialJsKb
      : budgets.chunkJsKb;
    if (sizeKb > budget) {
      violations.push(`${file.replace(projectRoot + '/', '')} is ${formatKb(sizeBytes)} kB (budget: ${budget} kB)`);
    }
  }

  if (ext === '.css' && sizeKb > budgets.cssKb) {
    violations.push(`${file.replace(projectRoot + '/', '')} is ${formatKb(sizeBytes)} kB (budget: ${budgets.cssKb} kB)`);
  }
}

if (violations.length) {
  console.error('Performance budget violations detected:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  if (failOnExceed) {
    process.exit(1);
  }
  console.warn('Performance budget check completed with warnings.');
} else {
  console.log('All bundled assets are within the configured performance budgets.');
}
