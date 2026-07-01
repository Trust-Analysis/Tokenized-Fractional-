// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/dataService.js — data persistence layer.
 * Reads and writes asset data and webhook data from/to JSON files.
 * Also owns the full-text search index.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DATA_FILE, WEBHOOK_DATA_FILE } from '../config.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve relative to the backend root (two levels up from src/services/)
const BACKEND_ROOT = join(__dirname, '..', '..');

// ── Asset data ────────────────────────────────────────────────────────────────

function getDataFile() {
  return join(BACKEND_ROOT, DATA_FILE);
}

export function loadData() {
  const file = getDataFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    logger.error('Corrupted data file, starting fresh');
    return {};
  }
}

export function saveData(data) {
  writeFileSync(getDataFile(), JSON.stringify(data, null, 2), 'utf-8');
}

// ── Webhook data ──────────────────────────────────────────────────────────────

function getWebhookFile() {
  return join(BACKEND_ROOT, WEBHOOK_DATA_FILE);
}

export function loadWebhooks() {
  const file = getWebhookFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    logger.error('Corrupted webhook data file, starting fresh');
    return {};
  }
}

export function saveWebhooks(data) {
  writeFileSync(getWebhookFile(), JSON.stringify(data, null, 2), 'utf-8');
}

// ── Full-Text Search Index ────────────────────────────────────────────────────
// In-memory inverted index: term → { contractId: tf }
let _searchIndex = null;

/**
 * Tokenise a string into lowercase words (removes punctuation).
 */
export function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Build or rebuild the full-text inverted index from the provided data store.
 * Called at startup and after every mutating operation.
 */
export function buildSearchIndex(data) {
  const index = {};
  const docCount = {};

  for (const [contractId, meta] of Object.entries(data)) {
    const fields = [
      { value: meta.title, weight: 3 },
      { value: meta.location, weight: 2 },
      { value: meta.description, weight: 1 },
      { value: meta.assetType, weight: 2 },
    ];

    const termFreq = {};
    let total = 0;
    for (const { value, weight } of fields) {
      const tokens = tokenize(value);
      for (const token of tokens) {
        termFreq[token] = (termFreq[token] || 0) + weight;
        total += weight;
      }
    }
    docCount[contractId] = total || 1;

    for (const [term, freq] of Object.entries(termFreq)) {
      if (!index[term]) index[term] = {};
      index[term][contractId] = freq / docCount[contractId]; // TF
    }
  }

  _searchIndex = { index, totalDocs: Object.keys(data).length };
  return _searchIndex;
}

/**
 * Ensure the index is built (lazy init).
 */
function getSearchIndex() {
  if (!_searchIndex) buildSearchIndex(loadData());
  return _searchIndex;
}

/**
 * Sync the search index after data mutations (fire-and-forget safe).
 */
export function syncSearchIndex() {
  try {
    buildSearchIndex(loadData());
  } catch (err) {
    logger.error({ err }, 'Failed to sync search index');
  }
}

/**
 * Score assets for a query using TF-IDF-like relevance.
 * Returns an array of { contractId, score } sorted descending.
 */
export function scoreSearch(query, data) {
  const { index, totalDocs } = getSearchIndex();
  const terms = tokenize(query);
  if (terms.length === 0) {
    return Object.keys(data).map((id) => ({ contractId: id, score: 1 }));
  }

  const scores = {};
  for (const term of terms) {
    const postings = index[term] || {};
    const df = Object.keys(postings).length;
    if (df === 0) continue;
    const idf = Math.log((totalDocs + 1) / (df + 1)) + 1;
    for (const [contractId, tf] of Object.entries(postings)) {
      scores[contractId] = (scores[contractId] || 0) + tf * idf;
    }
  }

  return Object.entries(scores)
    .map(([contractId, score]) => ({ contractId, score }))
    .sort((a, b) => b.score - a.score);
}
