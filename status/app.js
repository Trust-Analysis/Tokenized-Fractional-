// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * status/app.js — issue #797
 *
 * DOM wiring for the public status page. All evaluation lives in status.js;
 * this file only renders what that module returns.
 */

import { STATUS, collectStatus } from './status.js';

const REFRESH_INTERVAL_MS = 60_000;

const TIERS = [
  { id: 'api', label: 'Backend API', description: 'Asset metadata and marketplace data' },
  { id: 'web', label: 'Web application', description: 'The interface itself' },
  { id: 'rpc', label: 'Stellar RPC', description: 'Ledger access for contract reads and writes' },
];

/**
 * Render the overall verdict.
 *
 * @param {HTMLElement} element
 * @param {{ status: string, label: string, affected: string[] }} overall
 */
function renderOverall(element, overall) {
  const isClean = overall.status === STATUS.OPERATIONAL;
  const hasOutage = overall.status === STATUS.OUTAGE;
  const affectedLabels = overall.affected
    .map((id) => TIERS.find((tier) => tier.id === id)?.label ?? id)
    .join(', ');

  element.className = `overall overall--${overall.status}`;
  element.textContent = isClean
    ? 'All systems operational'
    : hasOutage
      ? `Service disruption${affectedLabels ? `: ${affectedLabels}` : ''}`
      : `${overall.label}${affectedLabels ? `: ${affectedLabels}` : ''}`;
}

/**
 * Render the three tier rows.
 *
 * @param {HTMLElement} container
 * @param {Array<object>} checks
 */
function renderChecks(container, checks) {
  container.replaceChildren();

  for (const tier of TIERS) {
    const check = checks.find((entry) => entry.id === tier.id);
    if (!check) continue;

    const row = document.createElement('li');
    row.className = 'tier';

    const name = document.createElement('div');
    name.className = 'tier__name';
    name.textContent = tier.label;

    const description = document.createElement('div');
    description.className = 'tier__description';
    description.textContent = tier.description;

    const pill = document.createElement('span');
    pill.className = `pill pill--${check.status}`;
    pill.textContent = check.label;

    const detail = document.createElement('div');
    detail.className = 'tier__detail';
    detail.textContent = check.latencyMs === null ? check.detail : `${check.detail} · ${check.latencyMs}ms`;

    row.append(name, description, pill, detail);
    container.append(row);
  }
}

/**
 * Render a failure to measure anything at all.
 *
 * @param {HTMLElement} overall
 * @param {HTMLElement} checks
 * @param {unknown} error
 */
function renderFailure(overall, checks, error) {
  overall.className = 'overall overall--unknown';
  overall.textContent = 'Status unavailable';
  checks.replaceChildren();

  const row = document.createElement('li');
  row.className = 'tier';
  row.textContent = `The status page could not run its checks: ${error?.message || error}`;
  checks.append(row);
}

async function refresh() {
  const overall = document.getElementById('overall');
  const checks = document.getElementById('checks');
  const timestamp = document.getElementById('timestamp');

  try {
    const snapshot = await collectStatus();
    renderOverall(overall, snapshot.overall);
    renderChecks(checks, snapshot.checks);
    timestamp.textContent = `Last checked ${new Date(snapshot.generatedAt).toLocaleTimeString()}`;
  } catch (error) {
    renderFailure(overall, checks, error);
    timestamp.textContent = 'Last check failed';
  }
}

refresh();
setInterval(refresh, REFRESH_INTERVAL_MS);
