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
import {
  uploadToIPFS,
  getIPFSFileUrl,
  unpinFromIPFS,
  pinJSONToIPFS,
  pinAssetMetadataToIPFS,
} from '../../ipfs.js';
import { storeMetadataCidOnContract } from '../services/sorobanMetadataService.js';
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
/**
 * @openapi
 * /api/v1/rwa/export:
 *   get:
 *     tags: [Assets]
 *     summary: Export assets
 *     description: Export all assets in JSON or CSV format with optional date range filtering. Admin only.
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, csv], default: json }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Exported data
 *       401:
 *         description: Unauthorized
 */
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
/**
 * @openapi
 * /api/v1/rwa:
 *   get:
 *     tags: [Assets]
 *     summary: List all RWA assets
 *     description: Retrieve all approved real-world asset metadata with optional pagination and filtering.
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *         description: Maximum number of assets to return
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *         description: Number of assets to skip (for pagination)
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Full-text search across title, location, description
 *       - in: query
 *         name: assetType
 *         schema: { type: string }
 *         description: Filter by asset type
 *     responses:
 *       200:
 *         description: List of assets
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Asset' }
 *             example:
 *               - contractId: "CABC123..."
 *                 title: "Luxury Apartment"
 *                 location: "New York, USA"
 *                 assetType: "real_estate"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
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
/**
 * @openapi
 * /api/v1/rwa/search:
 *   get:
 *     tags: [Assets]
 *     summary: Search assets
 *     description: Full-text search across asset metadata with relevance scoring.
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Search query
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Asset' }
 *       400:
 *         description: Missing query parameter
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
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
/**
 * @openapi
 * /api/v1/rwa/pending:
 *   get:
 *     tags: [Assets]
 *     summary: List pending assets
 *     description: Get all assets with pending verification status. Admin only.
 *     security: [{ ApiKeyAuth: [] }]
 *     responses:
 *       200:
 *         description: List of pending assets
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Asset' }
 *       401:
 *         description: Unauthorized
 */
v1.get('/rwa/pending', adminAuth, (req, res) => {
  const data = loadData();
  const pending = Object.entries(data)
    .filter(([, meta]) => meta.status === ASSET_STATUS.PENDING)
    .map(([contractId, meta]) => ({ contractId, ...meta }));
  res.json(pending);
});

// ── GET /rwa/:contractId ──────────────────────────────────────────────────────
/**
 * @openapi
 * /api/v1/rwa/{contractId}:
 *   get:
 *     tags: [Assets]
 *     summary: Get asset by contract ID
 *     description: Retrieve a single asset's metadata by its Soroban contract ID.
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *         description: Soroban contract ID (starts with C)
 *     responses:
 *       200:
 *         description: Asset details
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Asset' }
 *       404:
 *         description: Asset not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
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
/**
 * @openapi
 * /api/v1/rwa:
 *   post:
 *     tags: [Assets]
 *     summary: Create or update an asset
 *     description: Create a new RWA asset or update an existing one by contract ID. Admin only.
 *     security: [{ ApiKeyAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AssetInput' }
 *           example:
 *             contractId: "CABC123DEF..."
 *             title: "Luxury Apartment Complex"
 *             location: "New York, USA"
 *             description: "A premium residential property"
 *             assetType: "real_estate"
 *     responses:
 *       201:
 *         description: Asset created/updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Asset' }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
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

  // If tokenize or pinToIPFS requested during standard asset creation
  if (metadata.tokenize === true || metadata.pinToIPFS === true) {
    try {
      const ipfsResult = await pinAssetMetadataToIPFS({
        metadata: { contractId, ...data[contractId] },
      });
      data[contractId].metadataCid = ipfsResult.metadataCid;
      data[contractId].metadataUri = ipfsResult.metadataUri;
      if (ipfsResult.imageUrl) data[contractId].imageUrl = ipfsResult.imageUrl;

      await storeMetadataCidOnContract({
        contractId,
        cid: ipfsResult.metadataCid,
        uri: ipfsResult.metadataUri,
      });
    } catch (err) {
      req.log?.warn?.({ err, contractId }, 'IPFS metadata pinning during asset creation skipped/failed');
    }
  }

  saveData(data);

  cacheDel('rwa:all').catch(() => {});
  syncSearchIndex();
  fireWebhooks(WEBHOOK_EVENTS.CREATED, { contractId, ...data[contractId] }).catch(() => {});

  req.log?.info({ contractId }, 'Asset created/updated');
  res.status(201).json({ contractId, ...data[contractId] });
});

// ── POST /rwa/tokenize ────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/v1/rwa/tokenize:
 *   post:
 *     tags: [Assets]
 *     summary: Tokenize asset with immutable IPFS metadata & Soroban on-chain storage
 *     description: Pins associated appraisals, images, and JSON metadata to IPFS and stores the resulting CID on the Soroban smart contract. Admin only.
 *     security: [{ ApiKeyAuth: [] }]
 */
v1.post('/rwa/tokenize', adminAuth, writeLimiter, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'appraisals', maxCount: 10 },
]), async (req, res) => {
  const { contractId, ...metadata } = req.body;

  if (!contractId || !validateContractId(contractId)) {
    return res.status(400).json({ error: 'Invalid contract ID. Must start with C and be at least 50 characters.' });
  }

  const validationError = validateRwaBody(metadata);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const imageFile = req.files?.image?.[0];
    const appraisalFiles = req.files?.appraisals || [];

    const appraisalsList = appraisalFiles.map(file => ({
      buffer: file.buffer,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    }));

    // 1. Pin image, appraisals, and JSON metadata to IPFS (Issue #516)
    const ipfsResult = await pinAssetMetadataToIPFS({
      metadata: { contractId, ...metadata },
      imageBuffer: imageFile ? imageFile.buffer : null,
      imageFileName: imageFile ? imageFile.originalname : 'image.jpg',
      appraisals: appraisalsList,
    });

    // 2. Store resulting CID on Soroban smart contract (Issue #516)
    const onChainResult = await storeMetadataCidOnContract({
      contractId,
      cid: ipfsResult.metadataCid,
      uri: ipfsResult.metadataUri,
    });

    // 3. Save asset data with IPFS CIDs and on-chain status
    const data = loadData();
    const now = new Date().toISOString();
    data[contractId] = {
      id: metadata.id || contractId,
      title: metadata.title,
      location: metadata.location,
      description: metadata.description,
      assetType: metadata.assetType,
      imageUrl: ipfsResult.imageUrl || metadata.imageUrl || '',
      imageCid: ipfsResult.imageCid || null,
      metadataCid: ipfsResult.metadataCid,
      metadataUri: ipfsResult.metadataUri,
      totalValuation: metadata.totalValuation || '',
      documents: ipfsResult.documents,
      status: ASSET_STATUS.PENDING,
      onChainSynced: onChainResult.success,
      submittedAt: now,
      createdAt: metadata.createdAt || now,
      updatedAt: now,
    };
    saveData(data);

    cacheDel('rwa:all', cacheKey(contractId)).catch(() => {});
    syncSearchIndex();
    fireWebhooks(WEBHOOK_EVENTS.CREATED, { contractId, ...data[contractId] }).catch(() => {});

    req.log?.info({ contractId, metadataCid: ipfsResult.metadataCid }, 'Asset tokenized with IPFS & Soroban');
    res.status(201).json({
      contractId,
      metadataCid: ipfsResult.metadataCid,
      metadataUri: ipfsResult.metadataUri,
      onChainResult,
      ...data[contractId],
    });
  } catch (err) {
    req.log?.error({ err, contractId }, 'Tokenization failed');
    res.status(502).json({ error: `Tokenization failed: ${err.message}` });
  }
});

// ── GET /rwa/:contractId/ipfs-metadata ────────────────────────────────────────
v1.get('/rwa/:contractId/ipfs-metadata', async (req, res) => {
  const { contractId } = req.params;
  const data = loadData();
  const asset = data[contractId];
  if (!asset) return res.status(404).json({ error: 'Asset metadata not found' });
  if (!asset.metadataCid) return res.status(404).json({ error: 'Asset has not been tokenized on IPFS yet' });

  const url = getIPFSFileUrl(asset.metadataCid);

  if (req.query.format === 'json' || req.headers.accept?.includes('application/json')) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const metadata = await response.json();
        return res.json(metadata);
      }
    } catch {
      // Fall through to redirect
    }
  }

  res.redirect(302, url);
});

// ── DELETE /rwa/:contractId ───────────────────────────────────────────────────
/**
 * @openapi
 * /api/v1/rwa/{contractId}:
 *   delete:
 *     tags: [Assets]
 *     summary: Delete an asset
 *     description: Permanently delete an RWA asset by contract ID. Admin only.
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Asset deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 contractId: { type: string }
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Asset not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
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
/**
 * @openapi
 * /api/v1/rwa/{contractId}:
 *   patch:
 *     tags: [Assets]
 *     summary: Update an asset
 *     description: Partially update an existing RWA asset. Admin only.
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AssetInput' }
 *     responses:
 *       200:
 *         description: Asset updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Asset' }
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Asset not found
 */
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
/**
 * @openapi
 * /api/v1/news:
 *   get:
 *     tags: [News]
 *     summary: Get platform news
 *     description: Retrieve the latest platform announcements and news items.
 *     responses:
 *       200:
 *         description: List of news items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   title: { type: string }
 *                   summary: { type: string }
 *                   date: { type: string, format: date-time }
 *                   link: { type: string }
 */
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
