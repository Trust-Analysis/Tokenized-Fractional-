// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { Router } from 'express';

export function createFlashLoanProtectionRoutes(flashLoanService, adminAuthMiddleware) {
  const router = Router();
  const authGuard = adminAuthMiddleware || ((_req, _res, next) => next());

  router.get('/config', (_req, res) => {
    res.json({ config: flashLoanService.getConfig() });
  });

  router.patch('/config', authGuard, (req, res) => {
    const updated = flashLoanService.updateConfig(req.body);
    res.json({ config: updated });
  });

  router.post('/validate', (req, res) => {
    const result = flashLoanService.validateTransaction(req.body);
    if (!result.allowed) {
      return res.status(422).json(result);
    }
    res.json(result);
  });

  router.get('/logs', authGuard, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({ logs: flashLoanService.getLogs(limit) });
  });

  return router;
}
