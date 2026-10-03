import { isReorgInProgress } from '../services/indexingEngine.js';

/**
 * Re-org Guard Middleware (#416)
 *
 * Client APIs temporarily return a 503 Service Unavailable during rollback operations.
 */
export function reorgGuardMiddleware(req, res, next) {
  if (isReorgInProgress()) {
    const errorResponse = {
      error: 'Service Unavailable',
      code: 'REORG_IN_PROGRESS',
      message: 'Blockchain chain re-organization in progress. Database is rolling back orphaned state. Please retry shortly.',
    };

    if (typeof res.status === 'function') {
      return res.status(503).json(errorResponse);
    }
    if (typeof res.code === 'function') {
      return res.code(503).send(errorResponse);
    }
  }

  if (typeof next === 'function') {
    return next();
  }
}

export default reorgGuardMiddleware;
