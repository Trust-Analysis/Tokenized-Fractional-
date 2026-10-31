#!/usr/bin/env node
// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * check-unmounted-routes.js — Issue #909: Detect Unmounted Route Files
 *
 * Scans backend/src/routes/*.js and standalone directories (search/, gateway/, graphql/)
 * to detect route files that are defined but never mounted or imported into the Express app.
 * Fails the build if any unreferenced/unmounted route file is discovered.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');
const repoRootDir = path.resolve(backendDir, '..');

let totalChecked = 0;
let totalUnmounted = 0;
const results = [];

/**
 * Check if a route file basename is imported or referenced in a target entry file.
 * @param {string} routeFile - Filename, e.g. "statements.js"
 * @param {string} entryContent - Content of app.js or entry file
 * @returns {boolean}
 */
function isFileReferenced(routeFile, entryContent) {
  const baseName = path.basename(routeFile, path.extname(routeFile));
  // Check exact filename reference, relative import path, or named router reference
  const patterns = [
    new RegExp(`['"\`].*?${baseName}(\\.js)?['"\`]`),
    new RegExp(`\\b${baseName}\\b`),
  ];
  return patterns.some((p) => p.test(entryContent));
}

/**
 * Audit routes in a directory against an entrypoint file or set of files.
 * @param {string} label - Context name
 * @param {string} routesDir - Path to directory containing route files
 * @param {string|string[]} entryFiles - Path(s) to application entrypoint(s)
 */
function auditRouteDirectory(label, routesDir, entryFiles) {
  if (!fs.existsSync(routesDir)) {
    return;
  }

  const entries = Array.isArray(entryFiles) ? entryFiles : [entryFiles];
  let combinedEntryContent = '';
  for (const entry of entries) {
    if (fs.existsSync(entry)) {
      combinedEntryContent += '\n' + fs.readFileSync(entry, 'utf-8');
    }
  }

  const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

  for (const file of files) {
    totalChecked++;
    const isReferenced = isFileReferenced(file, combinedEntryContent);
    const fullPath = path.join(routesDir, file);

    if (!isReferenced) {
      totalUnmounted++;
      results.push({
        module: label,
        file: path.relative(repoRootDir, fullPath),
        status: 'UNMOUNTED',
        error: `Route file is defined but never imported or mounted in ${entries.map(e => path.relative(repoRootDir, e)).join(', ')}`,
      });
    } else {
      results.push({
        module: label,
        file: path.relative(repoRootDir, fullPath),
        status: 'MOUNTED',
      });
    }
  }
}

console.log('=================================================================');
console.log(' Route File Mounting & Inclusion Audit (Issue #909)');
console.log('=================================================================\n');

// 1. Audit backend/src/routes/*.js against backend/src/app.js
auditRouteDirectory(
  'backend',
  path.join(backendDir, 'src', 'routes'),
  [path.join(backendDir, 'src', 'app.js'), path.join(backendDir, 'index.js')]
);

// 2. Audit standalone search directory
auditRouteDirectory(
  'search',
  path.join(repoRootDir, 'search', 'routes'),
  [path.join(repoRootDir, 'search', 'backend', 'searchAPI.js'), path.join(backendDir, 'src', 'app.js')]
);

// Also check search/backend for route handlers
if (fs.existsSync(path.join(repoRootDir, 'search', 'backend'))) {
  auditRouteDirectory(
    'search/backend',
    path.join(repoRootDir, 'search', 'backend'),
    [path.join(repoRootDir, 'search', 'backend', 'searchAPI.js'), path.join(backendDir, 'index.js')]
  );
}

// 3. Audit standalone gateway directory
auditRouteDirectory(
  'gateway',
  path.join(repoRootDir, 'gateway', 'routes'),
  [path.join(repoRootDir, 'gateway', 'BACKEND_INTEGRATION.js'), path.join(backendDir, 'src', 'app.js')]
);

// 4. Audit standalone graphql directory
auditRouteDirectory(
  'graphql',
  path.join(repoRootDir, 'graphql', 'routes'),
  [path.join(repoRootDir, 'graphql', 'api', 'adminRoutes.js'), path.join(backendDir, 'index.js'), path.join(backendDir, 'src', 'app.js')]
);

auditRouteDirectory(
  'graphql/api',
  path.join(repoRootDir, 'graphql', 'api'),
  [path.join(backendDir, 'index.js'), path.join(backendDir, 'src', 'app.js'), path.join(repoRootDir, 'graphql', 'api', 'adminRoutes.js')]
);

// Display summary
console.log('Audited Route Files:');
console.table(results);

console.log(`\nAudit Summary: Checked ${totalChecked} route file(s). Found ${totalUnmounted} unmounted file(s).\n`);

if (totalUnmounted > 0) {
  console.error('FAILED: Unmounted route files detected! Every defined route file must be mounted with proper auth/review or removed.');
  process.exit(1);
} else {
  console.log('SUCCESS: All defined route files are verified and mounted.');
  process.exit(0);
}
