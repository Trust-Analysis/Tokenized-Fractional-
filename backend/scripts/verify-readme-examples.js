#!/usr/bin/env node
/**
 * backend/scripts/verify-readme-examples.js
 *
 * Issue #805: "docs as tests" for the README's backend API examples.
 *
 * Extracts every example between the `readme-api-examples:start` / `:end`
 * markers in the root README.md, runs each `curl` command exactly as written
 * (in order, via bash) against a locally started backend, and fails if the
 * HTTP status or the response body no longer matches what the README shows.
 *
 * Example format in the README:
 *
 *   ```bash
 *   # Expected status: 201
 *   curl -X POST http://localhost:3001/api/rwa ...
 *   ```
 *
 *   ```json
 *   { "status": "pending", "createdAt": "<iso-timestamp>" }
 *   ```
 *
 * The JSON block is matched as a subset: every key shown must be present in
 * the real response with an equal value, extra keys in the response are
 * allowed, and a string value of the form "<...>" matches any non-empty value.
 * For arrays, each shown element must match the element at the same index.
 *
 * Usage:
 *   node scripts/verify-readme-examples.js          # starts the backend itself
 *   API_URL=http://host:port ADMIN_API_KEY=... \
 *     node scripts/verify-readme-examples.js        # uses a running backend
 */

import { spawn, spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(__dirname, '..');
const README = join(BACKEND_DIR, '..', 'README.md');

const README_BASE_URL = 'http://localhost:3001';
const START_MARKER = '<!-- readme-api-examples:start -->';
const END_MARKER = '<!-- readme-api-examples:end -->';
const STATUS_MARKER = '__README_EXAMPLE_HTTP_STATUS__:';
const DATA_FILE = 'readme-examples-data.json';

// ── README parsing ────────────────────────────────────────────────────────────

export function extractExamples(markdown) {
  const start = markdown.indexOf(START_MARKER);
  const end = markdown.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README is missing the ${START_MARKER} / ${END_MARKER} markers`);
  }
  const region = markdown.slice(start + START_MARKER.length, end);

  const blocks = [...region.matchAll(/```(\w+)\r?\n([\s\S]*?)```/g)].map(m => ({
    lang: m[1],
    body: m[2],
    line: markdown.slice(0, start + START_MARKER.length + m.index).split('\n').length,
  }));

  const examples = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.lang !== 'bash') continue;

    const statusMatch = block.body.match(/^#\s*Expected status:\s*(\d{3})\s*$/m);
    if (!statusMatch) {
      throw new Error(`README.md:${block.line}: bash example has no "# Expected status: NNN" line`);
    }
    const command = block.body
      .split(/\r?\n/)
      .filter(l => !l.trim().startsWith('#'))
      .join('\n')
      .trim();

    let expectedBody;
    const next = blocks[i + 1];
    if (next && next.lang === 'json') {
      try {
        expectedBody = JSON.parse(next.body);
      } catch (err) {
        throw new Error(`README.md:${next.line}: expected-response JSON does not parse: ${err.message}`);
      }
    }

    examples.push({
      line: block.line,
      command,
      expectedStatus: Number(statusMatch[1]),
      expectedBody,
    });
  }

  if (examples.length === 0) throw new Error('No examples found between the README markers');
  return examples;
}

// ── Response matching ─────────────────────────────────────────────────────────

const isPlaceholder = v => typeof v === 'string' && /^<[^>]+>$/.test(v);

export function matchSubset(expected, actual, path = '$') {
  if (isPlaceholder(expected)) {
    return actual === undefined || actual === null || actual === ''
      ? [`${path}: expected a value (${expected}), got ${JSON.stringify(actual)}`]
      : [];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected an array, got ${JSON.stringify(actual)}`];
    return expected.flatMap((item, i) =>
      i < actual.length
        ? matchSubset(item, actual[i], `${path}[${i}]`)
        : [`${path}[${i}]: missing (response array has ${actual.length} element(s))`]
    );
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
      return [`${path}: expected an object, got ${JSON.stringify(actual)}`];
    }
    return Object.entries(expected).flatMap(([key, value]) =>
      key in actual
        ? matchSubset(value, actual[key], `${path}.${key}`)
        : [`${path}.${key}: missing from response`]
    );
  }
  return expected === actual
    ? []
    : [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

// ── Execution ─────────────────────────────────────────────────────────────────

function runExample(example, { baseUrl, apiKey }) {
  const command = example.command.split(README_BASE_URL).join(baseUrl);
  const result = spawnSync('bash', ['-c', `${command} -sS -w '\\n${STATUS_MARKER}%{http_code}'`], {
    env: { ...process.env, ADMIN_API_KEY: apiKey },
    encoding: 'utf-8',
    timeout: 15000,
  });

  if (result.error) return { errors: [`could not run curl: ${result.error.message}`] };
  if (result.status !== 0) {
    return { errors: [`curl exited with ${result.status}: ${result.stderr.trim()}`] };
  }

  const idx = result.stdout.lastIndexOf(STATUS_MARKER);
  const rawBody = result.stdout.slice(0, idx).trim();
  const status = Number(result.stdout.slice(idx + STATUS_MARKER.length).trim());

  const errors = [];
  if (status !== example.expectedStatus) {
    errors.push(`HTTP status: expected ${example.expectedStatus}, got ${status}`);
  }
  if (example.expectedBody !== undefined) {
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      errors.push(`response is not JSON: ${rawBody.slice(0, 200)}`);
    }
    if (body !== undefined) errors.push(...matchSubset(example.expectedBody, body));
  }
  return { errors, status, rawBody };
}

async function waitForHealth(baseUrl, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`backend exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`backend did not become healthy at ${baseUrl} within ${timeoutMs}ms`);
}

function removeDataFile() {
  const file = join(BACKEND_DIR, DATA_FILE);
  if (existsSync(file)) unlinkSync(file);
}

function startBackend(port, apiKey) {
  removeDataFile();
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    ADMIN_API_KEY: apiKey,
    CORS_ORIGINS: 'http://localhost:5173',
    DATA_FILE,
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
  };
  // Examples assume a bare backend: no Redis cache and no consistency scheduler.
  delete env.REDIS_URL;
  delete env.CONSISTENCY_CHECK_ENABLED;

  const child = spawn(process.execPath, ['index.js'], { cwd: BACKEND_DIR, env, stdio: ['ignore', 'inherit', 'inherit'] });
  return child;
}

async function main() {
  const examples = extractExamples(readFileSync(README, 'utf-8'));
  console.log(`Found ${examples.length} README API example(s)`);

  const external = Boolean(process.env.API_URL);
  const apiKey = external ? process.env.ADMIN_API_KEY : randomBytes(24).toString('hex');
  if (external && !apiKey) throw new Error('ADMIN_API_KEY must be set when API_URL is used');

  const baseUrl = external ? process.env.API_URL.replace(/\/$/, '') : README_BASE_URL;
  const child = external ? null : startBackend(new URL(README_BASE_URL).port, apiKey);

  let failures = 0;
  try {
    await waitForHealth(baseUrl, child);

    for (const example of examples) {
      const summary = example.command.split('\n')[0];
      const { errors, rawBody } = runExample(example, { baseUrl, apiKey });
      if (errors.length === 0) {
        console.log(`  ✓ README.md:${example.line}  ${summary}`);
      } else {
        failures += 1;
        console.error(`  ✗ README.md:${example.line}  ${summary}`);
        errors.forEach(e => console.error(`      ${e}`));
        if (rawBody) console.error(`      response: ${rawBody.slice(0, 500)}`);
      }
    }
  } finally {
    if (child) child.kill();
    if (!external) removeDataFile();
  }

  if (failures > 0) {
    console.error(`\n${failures} README example(s) no longer match the API. Update the README or fix the regression.`);
    process.exit(1);
  }
  console.log('\nAll README API examples match the running backend.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
