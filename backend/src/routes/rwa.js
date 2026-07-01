// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/routes/rwa.js — RWA asset route handlers mounted on /api/v1 (and /api alias).
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { adminAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import {
  loadData, saveData,
  loadWebhooks, saveWebhooks,
  buildSearchIndex, scoreSearch, syncSearchIndex,
} from '../services/dataService.js';
import { fireWebhooks } from '../services/webhookService.js';
import { cacheGet, cacheSet, cacheDel } from '../../cache.js';
import { uploadToIPFS, getIPFSFileUrl, unpinFromIPFS } from '../../ipfs.js';
import { validateContractId, validateRwaBody, validateWebhookBody } from '../validators/rwaValidator.js';
import { ASSET_STATUS, WEBHOOK_EVENTS } from '../config.js';

// ── multer setup ──────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PDF, JPEG, PNG, WEBP`));
    }
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function cacheKey(contractId) { return `rwa:${contractId}`; }
function isApproved(asset) { return !asset.status || asset.status === ASSET_STATUS.APPROVED; }
function generateWebhookId() { return 'wh_' + randomUUID().replace(/-/g, '').slice(0, 16); }

export const v1 = Router();

// ── Static news data ──────────────────────────────────────────────────────────
const NEWS_STORAGE = [
  {
    id: '1',
    title: 'Platform Launch',
    summary: 'The RWA Marketplace is now live on Stellar Testnet. Start exploring tokenized real-world assets.',
    date: new Date().toISOString(),
    link: 'https://github.com/Trust-Analysis/Tokenized-Fractional-',
  },
  {
    id: '2',
    title: 'New Asset Listings',
    summary: 'Multiple new real estate and asset-backed tokens are now available for purchase in the marketplace.',
    date: new Date(Date.now() - 86400000 * 2).toISOString(),
    link: '#',
  },
];

// ── GET /rwa/export ───────────────────────────────────────────────────────────
v1.get('/rwa/export', adminAuth, (req, res) => {
  const { format = 'json', from, to } = req.query;

  if (!['json', 'csv'].includes(format)) {
    return res.status(400).json({ error: 'format must be "json" or "csv"' });
  }

  const fromDate = from ? new Date(from) : null;
  const toDate   = to   ? new Date(to)   : null;

  if (from && isNaN(fromDate)) return res.status(400).json({ error: 'Invalid "from" date' });
  if (to   && isNaN(toDate))   return res.status(400).json({ error: 'Invalid "to" date' });

  const data = loadData();
  let assets = Object.entries(data).map(([contractId, meta]) => ({ contractId, ...meta }));

  if (fromDate) assets = assets.filter(a => new Date(a.updatedAt || a.createdAt) >= fromDate);
  if (toDate)   assets = assets.filter(a => new Date(a.updatedAt || a.createdAt) <= toDate);

  const filename = `rwa-export-${Date.now()}.${format}`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  if (format === 'csv') {
    const cols = ['contractId', 'id', 'title', 'location', 'description', 'assetType', 'imageUrl', 'totalValuation', 'createdAt', 'updatedAt'];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [cols.join(','), ...assets.map(a => cols.map(c => escape(a[c])).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(rows.join('\r\n'));
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(assets);
});

// ── GET /rwa ──────────────────────────────────────────────────────────────────
v1.get('/rwa', (req, res) => {
  const data = loadData();
  let assets = Object.entries(data)
    .filter(([, meta]) => isApproved(meta))
    .map(([contractId, meta]) => ({ contractId, ...meta }));

  const { assetType, location, search, page, limit } = req.query;

  if (assetType) {
    const lower = assetType.toLowerCase();
    assets = assets.filter(a => a.assetType?.toLowerCase() === lower);
  }

  if (location) {
    const lower = location.toLowerCase();
    assets = assets.filter(a => a.location?.toLowerCase().includes(lower));
  }

  if (search) {
    const approvedData = Object.fromEntries(
      Object.entries(data).filter(([, m]) => isApproved(m))
    );
    buildSearchIndex(approvedData);
    const ranked = scoreSearch(search, approvedData);
    const rankedIds = new Set(ranked.map(r => r.contractId));
    const byId = Object.fromEntries(assets.map(a => [a.contractId, a]));
    assets = ranked
      .filter(r => rankedIds.has(r.contractId) && byId[r.contractId])
      .map(r => ({ ...byId[r.contractId], _score: r.score }));
  }

  const total     = assets.length;
  const pageNum   = Math.max(1, parseInt(page)  || 1);
  const pageSize  = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const totalPages = Math.ceil(total / pageSize) || 1;
  assets = assets.slice((pageNum - 1) * pageSize, pageNum * pageSize);

  res.json({ data: assets, pagination: { total, page: pageNum, limit: pageSize, totalPages } });
  cacheSet('rwa:all', { data: assets, pagination: { total, page: pageNum, limit: pageSize, totalPages } }).catch(() => {});
});

// ── GET /rwa/search ───────────────────────────────────────────────────────────
v1.get('/rwa/search', (req, res) => {
  const { q, assetType, location, page, limit } = req.query;
  if (!q || !String(q).trim()) {
    return res.status(400).json({ error: 'Missing required query parameter: q' });
  }

  const data = loadData();
  const approvedData = Object.fromEntries(
    Object.entries(data).filter(([, m]) => isApproved(m))
  );

  buildSearchIndex(approvedData);
  let ranked = scoreSearch(q, approvedData);

  if (assetType) {
    const lower = assetType.toLowerCase();
    ranked = ranked.filter(r => approvedData[r.contractId]?.assetType?.toLowerCase() === lower);
  }
  if (location) {
    const lower = location.toLowerCase();
    ranked = ranked.filter(r => approvedData[r.contractId]?.location?.toLowerCase().includes(lower));
  }

  const total     = ranked.length;
  const pageNum   = Math.max(1, parseInt(page)  || 1);
  const pageSize  = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const totalPages = Math.ceil(total / pageSize) || 1;
  const slice     = ranked.slice((pageNum - 1) * pageSize, pageNum * pageSize);

  const facets = { assetType: {}, location: {} };
  for (const { contractId } of ranked) {
    const m = approvedData[contractId];
    if (!m) continue;
    if (m.assetType) facets.assetType[m.assetType] = (facets.assetType[m.assetType] || 0) + 1;
    if (m.location) {
      const loc = m.location.split(',')[0].trim();
      facets.location[loc] = (facets.location[loc] || 0) + 1;
    }
  }

  const results = slice.map(({ contractId, score }) => ({
    contractId,
    ...approvedData[contractId],
    _score: score,
  }));

  res.json({ data: results, pagination: { total, page: pageNum, limit: pageSize, totalPages }, facets });
});

// ── GET /rwa/pending ──────────────────────────────────────────────────────────
v1.get('/rwa/pending', adminAuth, (req, res) => {
  const data = loadData();
  const pending = Object.entries(data)
    .filter(([, meta]) => meta.status === ASSET_STATUS.PENDING)
    .map(([contractId, meta]) => ({ contractId, ...meta }));
  res.json(pending);
});

// ── GET /rwa/:contractId ──────────────────────────────────────────────────────
v1.get('/rwa/:contractId', async (req, res) => {
  const { contractId } = req.params;

  const cached = await cacheGet(cacheKey(contractId));
  if (cached) return res.json(cached);

  const data  = loadData();
  const asset = data[contractId];
  if (!asset || !isApproved(asset)) {
    return res.status(404).json({ error: 'Asset metadata not found' });
  }

  const result = { contractId, ...asset };
  cacheSet(cacheKey(contractId), result).catch(() => {});
  res.json(result);
});

// ── POST /rwa ─────────────────────────────────────────────────────────────────
v1.post('/rwa', adminAuth, writeLimiter, async (req, res) => {
  const { contractId, ...metadata } = req.body;

  if (!contractId || !validateContractId(contractId)) {
    return res.status(400).json({ error: 'Invalid contract ID. Must start with C and be at least 50 characters.' });
  }

  const validationError = validateRwaBody(metadata);
  if (validationError) return res.status(400).json({ error: validationError });

  const data = loadData();
  const now  = new Date().toISOString();
  data[contractId] = {
    id:             metadata.id || contractId,
    title:          metadata.title,
    location:       metadata.location,
    description:    metadata.description,
    assetType:      metadata.assetType,
    imageUrl:       metadata.imageUrl || '',
    totalValuation: metadata.totalValuation || '',
    documents:      Array.isArray(metadata.documents) ? metadata.documents : [],
    status:         ASSET_STATUS.PENDING,
    submittedAt:    now,
    createdAt:      metadata.createdAt || now,
    updatedAt:      now,
  };
  saveData(data);

  cacheDel('rwa:all').catch(() => {});
  syncSearchIndex();
  fireWebhooks(WEBHOOK_EVENTS.CREATED, { contractId, ...data[contractId] }).catch(() => {});

  req.log?.info({ contractId }, 'Asset created/updated');
  res.status(201).json({ contractId, ...data[contractId] });
});

// ── DELETE /rwa/:contractId ───────────────────────────────────────────────────
v1.delete('/rwa/:contractId', adminAuth, writeLimiter, async (req, res) => {
  const { contractId } = req.params;
  const data = loadData();
  if (!data[contractId]) return res.status(404).json({ error: 'Asset metadata not found' });

  const deleted = { contractId, ...data[contractId] };

  if (Array.isArray(deleted.documents) && deleted.documents.length > 0) {
    Promise.allSettled(
      deleted.documents.filter(d => d.cid).map(d => unpinFromIPFS(d.cid))
    ).then(results => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          // logger imported via closure is not available here; use console as fallback
          console.warn('Failed to unpin document', deleted.documents[i]?.cid, r.reason);
        }
      });
    });
  }

  delete data[contractId];
  saveData(data);

  cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
  syncSearchIndex();
  fireWebhooks(WEBHOOK_EVENTS.DELETED, deleted).catch(() => {});

  req.log?.info({ contractId }, 'Asset deleted');
  res.json({ message: 'Asset metadata deleted', contractId });
});

// ── PATCH /rwa/:contractId ────────────────────────────────────────────────────
v1.patch('/rwa/:contractId', adminAuth, writeLimiter, async (req, res) => {
  const { contractId } = req.params;
  const patch = req.body;

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'Request body must contain at least one field to update' });
  }

  const data = loadData();
  if (!data[contractId]) return res.status(404).json({ error: 'Asset metadata not found' });

  const allowedFields = ['title', 'location', 'description', 'assetType', 'imageUrl', 'totalValuation', 'documents'];
  allowedFields.forEach(field => {
    if (field in patch && patch[field] !== undefined) {
      data[contractId][field] = patch[field];
    }
  });

  data[contractId].updatedAt = new Date().toISOString();
  saveData(data);

  cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
  syncSearchIndex();
  fireWebhooks(WEBHOOK_EVENTS.UPDATED, { contractId, ...data[contractId] }).catch(() => {});

  req.log?.info({ contractId, fields: Object.keys(patch) }, 'Asset partially updated');
  res.json({ contractId, ...data[contractId] });
});

// ── POST /rwa/:contractId/documents ──────────────────────────────────────────
v1.post('/rwa/:contractId/documents', adminAuth, writeLimiter, upload.single('document'), async (req, res) => {
  const { contractId } = req.params;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Send a multipart/form-data request with field name "document".' });
  }

  const data = loadData();
  if (!data[contractId]) {
    return res.status(404).json({ error: 'Asset metadata not found' });
  }

  try {
    const { cid, url, name } = await uploadToIPFS(
      req.file.buffer,
      req.file.originalname,
      data[contractId].title || contractId
    );

    const docEntry = {
      cid,
      url,
      name,
      mimeType:   req.file.mimetype,
      size:       req.file.size,
      uploadedAt: new Date().toISOString(),
    };

    if (!Array.isArray(data[contractId].documents)) data[contractId].documents = [];
    data[contractId].documents.push(docEntry);
    data[contractId].updatedAt = new Date().toISOString();
    saveData(data);

    cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
    req.log?.info({ contractId, cid }, 'Document uploaded to IPFS');
    res.json({ contractId, document: docEntry, documents: data[contractId].documents });
  } catch (err) {
    req.log?.error({ err, contractId }, 'IPFS upload failed');
    res.status(502).json({ error: `IPFS upload failed: ${err.message}` });
  }
});

// ── GET /rwa/:contractId/documents/:cid ──────────────────────────────────────
v1.get('/rwa/:contractId/documents/:cid', async (req, res) => {
  const { contractId, cid } = req.params;
  const data  = loadData();
  const asset = data[contractId];
  if (!asset) return res.status(404).json({ error: 'Asset metadata not found' });

  const doc = asset.documents?.find(d => d.cid === cid);
  if (!doc) return res.status(404).json({ error: 'Document not found on this asset' });

  const url = getIPFSFileUrl(cid);
  req.log?.info({ contractId, cid, url }, 'Redirecting to IPFS document');
  res.redirect(302, url);
});

// ── POST /rwa/:contractId/approve ─────────────────────────────────────────────
v1.post('/rwa/:contractId/approve', adminAuth, writeLimiter, async (req, res) => {
  const { contractId } = req.params;
  const data = loadData();
  if (!data[contractId]) return res.status(404).json({ error: 'Asset metadata not found' });

  data[contractId].status     = ASSET_STATUS.APPROVED;
  data[contractId].reviewedAt = new Date().toISOString();
  data[contractId].reviewedBy = req.headers['x-reviewer'] || 'admin';
  data[contractId].updatedAt  = new Date().toISOString();
  saveData(data);

  cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
  fireWebhooks(WEBHOOK_EVENTS.APPROVED, { contractId, ...data[contractId] }).catch(() => {});
  req.log?.info({ contractId }, 'Asset approved');
  res.json({ contractId, ...data[contractId] });
});

// ── POST /rwa/:contractId/reject ──────────────────────────────────────────────
v1.post('/rwa/:contractId/reject', adminAuth, writeLimiter, async (req, res) => {
  const { contractId } = req.params;
  const data = loadData();
  if (!data[contractId]) return res.status(404).json({ error: 'Asset metadata not found' });

  data[contractId].status     = ASSET_STATUS.REJECTED;
  data[contractId].reviewedAt = new Date().toISOString();
  data[contractId].reviewedBy = req.headers['x-reviewer'] || 'admin';
  data[contractId].updatedAt  = new Date().toISOString();
  saveData(data);

  cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
  fireWebhooks(WEBHOOK_EVENTS.REJECTED, { contractId, ...data[contractId] }).catch(() => {});
  req.log?.info({ contractId }, 'Asset rejected');
  res.json({ contractId, ...data[contractId] });
});

// ── GET /news ─────────────────────────────────────────────────────────────────
v1.get('/news', (_req, res) => {
  res.json(NEWS_STORAGE);
});

// ── Webhook CRUD (admin only) ─────────────────────────────────────────────────

v1.get('/webhooks', adminAuth, (req, res) => {
  res.json(Object.values(loadWebhooks()));
});

v1.post('/webhooks', adminAuth, writeLimiter, (req, res) => {
  const error = validateWebhookBody(req.body);
  if (error) return res.status(400).json({ error });

  const id  = generateWebhookId();
  const now = new Date().toISOString();
  const webhooks = loadWebhooks();
  webhooks[id] = {
    id,
    url:           req.body.url,
    events:        req.body.events,
    secret:        req.body.secret || '',
    active:        req.body.active !== false,
    createdAt:     now,
    updatedAt:     now,
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount:  0,
  };
  saveWebhooks(webhooks);
  req.log?.info({ webhookId: id, url: req.body.url }, 'Webhook created');
  res.status(201).json(webhooks[id]);
});

v1.get('/webhooks/:id', adminAuth, (req, res) => {
  const webhooks = loadWebhooks();
  const wh = webhooks[req.params.id];
  if (!wh) return res.status(404).json({ error: 'Webhook not found' });
  res.json(wh);
});

v1.patch('/webhooks/:id', adminAuth, writeLimiter, (req, res) => {
  const webhooks = loadWebhooks();
  const wh = webhooks[req.params.id];
  if (!wh) return res.status(404).json({ error: 'Webhook not found' });

  ['url', 'events', 'secret', 'active'].forEach(f => {
    if (f in req.body && req.body[f] !== undefined) wh[f] = req.body[f];
  });
  wh.updatedAt = new Date().toISOString();
  saveWebhooks(webhooks);
  req.log?.info({ webhookId: req.params.id }, 'Webhook updated');
  res.json(wh);
});

v1.delete('/webhooks/:id', adminAuth, writeLimiter, (req, res) => {
  const webhooks = loadWebhooks();
  if (!webhooks[req.params.id]) return res.status(404).json({ error: 'Webhook not found' });
  delete webhooks[req.params.id];
  saveWebhooks(webhooks);
  req.log?.info({ webhookId: req.params.id }, 'Webhook deleted');
  res.json({ message: 'Webhook deleted', id: req.params.id });
});
