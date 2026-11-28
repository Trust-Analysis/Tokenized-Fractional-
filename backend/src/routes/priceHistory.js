import { createHash } from 'crypto';
import { Router } from 'express';
import { cacheGet, cacheSet } from '../../cache.js';
import { isValidContractId } from '../validators/rwaValidator.js';

const RESOLUTIONS = new Set(['raw', 'hour', 'day']);
const MAX_LIMIT = 500;
const MAX_OFFSET = 1_000_000;

function parseInteger(value, defaultValue, maximum) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function parseDate(value) {
  if (value === undefined) return { valid: true, date: undefined };
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return { valid: false };
  }
  return { valid: true, date: new Date(value) };
}

/**
 * @openapi
 * /api/v1/rwa/{contractId}/price-history:
 *   get:
 *     tags: [Assets]
 *     summary: Get asset price history
 *     description: Returns completed purchase prices for an asset, optionally filtered by time range and aggregated by hour or day. Results are paginated and cached for 60 seconds.
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema: { type: string, minLength: 56, maxLength: 56, pattern: '^C[A-Z2-7]{55}$' }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: resolution
 *         schema: { type: string, enum: [raw, hour, day], default: day }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 500, default: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, maximum: 1000000, default: 0 }
 *     responses:
 *       200:
 *         description: Paginated price history
 *       400:
 *         description: Invalid contract ID or query parameter
 *       500:
 *         description: Failed to retrieve price history
 * /api/rwa/{contractId}/price-history:
 *   get:
 *     tags: [Assets]
 *     summary: Get asset price history
 *     description: Returns completed purchase prices for an asset, optionally filtered by time range and aggregated by hour or day. Results are paginated and cached for 60 seconds.
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema: { type: string, minLength: 56, maxLength: 56, pattern: '^C[A-Z2-7]{55}$' }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: resolution
 *         schema: { type: string, enum: [raw, hour, day], default: day }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 500, default: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, maximum: 1000000, default: 0 }
 *     responses:
 *       200:
 *         description: Paginated price history
 *       400:
 *         description: Invalid contract ID or query parameter
 *       500:
 *         description: Failed to retrieve price history
 */
export function createPriceHistoryHandler(transactionService, logger) {
  return async (req, res) => {
    const { contractId } = req.params;
    if (!isValidContractId(contractId)) {
      return res.status(400).json({ error: 'Invalid contractId' });
    }

    const { from, to, resolution = 'day' } = req.query;
    const fromDate = parseDate(from);
    const toDate = parseDate(to);
    const limit = parseInteger(req.query.limit, 100, MAX_LIMIT);
    const offset = parseInteger(req.query.offset, 0, MAX_OFFSET);

    if (!fromDate.valid || !toDate.valid
      || (fromDate.date && toDate.date && fromDate.date > toDate.date)
      || !RESOLUTIONS.has(resolution)
      || limit === null || limit < 1
      || offset === null) {
      return res.status(400).json({ error: 'Invalid price history query parameters' });
    }

    const query = {
      from: fromDate.date,
      to: toDate.date,
      resolution,
      limit,
      offset,
    };
    const queryHash = createHash('sha256').update(JSON.stringify(query)).digest('hex');
    const cacheKey = `price_history_query:${contractId}:${queryHash}`;

    try {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        res.set('Cache-Control', 'public, max-age=60');
        return res.json(cached);
      }

      const result = await transactionService.getPriceHistory(contractId, query);
      const response = {
        contractId,
        data: result.data,
        pagination: {
          total: result.total,
          limit,
          offset,
          hasNext: offset + result.data.length < result.total,
        },
      };

      await cacheSet(cacheKey, response);
      res.set('Cache-Control', 'public, max-age=60');
      return res.json(response);
    } catch (error) {
      logger.error({ error: error.message, contractId, requestId: req.requestId }, 'Failed to retrieve price history');
      return res.status(500).json({ error: 'Failed to retrieve price history' });
    }
  };
}

export function createPriceHistoryRoutes(transactionService, logger) {
  const router = Router();
  router.get('/:contractId/price-history', createPriceHistoryHandler(transactionService, logger));

  return router;
}
