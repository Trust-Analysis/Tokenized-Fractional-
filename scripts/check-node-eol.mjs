#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_SCHEDULE_URL = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json';

function configuredVersion(file) {
  return readFileSync(join(REPO_ROOT, file), 'utf8').trim().replace(/^v/, '');
}

function fail(message) {
  console.error(`Node.js EOL check failed: ${message}`);
  process.exit(1);
}

try {
  const nvmrc = configuredVersion('.nvmrc');
  const nodeVersion = configuredVersion('.node-version');

  if (nvmrc !== nodeVersion) {
    fail(`.nvmrc (${nvmrc}) and .node-version (${nodeVersion}) disagree`);
  }

  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(nvmrc);
  if (!match) {
    fail(`configured version ${nvmrc} is not a full major.minor.patch release`);
  }

  const major = Number(match[1]);
  const response = await fetch(RELEASE_SCHEDULE_URL);
  if (!response.ok) {
    fail(`could not load the official release schedule (HTTP ${response.status})`);
  }

  const schedule = await response.json();
  const releaseLine = schedule[`v${major}`];
  if (!releaseLine?.end) {
    fail(`v${major} is not present in the official Node.js release schedule`);
  }

  const eol = new Date(`${releaseLine.end}T23:59:59Z`);
  if (Date.now() > eol.getTime()) {
    fail(`Node.js ${nvmrc} is on v${major}, which reached end-of-life on ${releaseLine.end}`);
  }

  console.log(`Node.js ${nvmrc} is supported; v${major} reaches end-of-life on ${releaseLine.end}.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
