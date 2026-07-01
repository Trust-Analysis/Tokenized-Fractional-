// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/routes/purchases.js — Purchase event recording endpoints
 *
 * The frontend calls these endpoints after a blockchain transaction
 * completes to log the purchase event for analytics.
 *
 * Endpoints:
 * - POST /purchases — Record a purchase event
 * - GET /purchases/:transactionId — Get purchase details
 * - GET /purchases/contract/:contractId — Get purchases for an asset
 */

import { Router } from 'express';

/**
 * Factory function to create purchase routes
 * @param {TransactionService} transactionService
 * @param {Object} logger
 * @returns {Router}
 */
export function createPurchaseRoutes(transactionService, logger) {
  const router = Router();

  /**
   * POST /purchases
   * Record a purchase/share buy event from the blockchain
   *
   * Body:
   * {
   *   contractId: string,
   *   buyerAddress: string,
   *   sharesPurchased: number,
   *   pricePerShare: number,
   *   totalAmount: number,
   *   paymentToken: string,
   *   blockchainHash?: string (optional Soroban tx hash)
   * }
   */
  router.post('/', async (req, res) => {
    try {
      const {
        contractId,
        buyerAddress,
        sharesPurchased,
        pricePerShare,
        totalAmount,
        paymentToken,
        blockchainHash,
      } = req.body;

      // Validate required fields
      const required = [
        'contractId',
        'buyerAddress',
        'sharesPurchased',
        'pricePerShare',
        'totalAmount',
        'paymentToken',
      ];
      const missing = required.filter((field) => !req.body[field]);
      if (missing.length > 0) {
        logger.warn({ missing, requestId: req.requestId }, 'Missing required fields');
        return res.status(400).json({
          error: 'Missing required fields',
          missingFields: missing,
        });
      }

      // Validate data types
      if (typeof contractId !== 'string' || !contractId.startsWith('C')) {
        return res.status(400).json({ error: 'Invalid contractId' });
      }

      if (typeof buyerAddress !== 'string' || buyerAddress.length < 10) {
        return res.status(400).json({ error: 'Invalid buyerAddress' });
      }

      if (isNaN(sharesPurchased) || sharesPurchased <= 0) {
        return res.status(400).json({ error: 'sharesPurchased must be a positive number' });
      }

      if (isNaN(pricePerShare) || pricePerShare <= 0) {
        return res.status(400).json({ error: 'pricePerShare must be a positive number' });
      }

      if (isNaN(totalAmount) || totalAmount <= 0) {
        return res.status(400).json({ error: 'totalAmount must be a positive number' });
      }

      // Record the purchase
      const transaction = await transactionService.recordPurchase({
        contractId,
        buyerAddress,
        sharesPurchased: parseFloat(sharesPurchased),
        pricePerShare: parseFloat(pricePerShare),
        totalAmount: parseFloat(totalAmount),
        paymentToken,
        blockchainHash: blockchainHash || null,
        metadata: {
          recordedAt: new Date().toISOString(),
          userAgent: req.headers['user-agent'],
        },
      });

      logger.info(
        {
          transactionId: transaction.transaction_id,
          contractId,
          buyerAddress: `${buyerAddress.slice(0, 10)}...`,
          sharesPurchased,
          totalAmount,
          requestId: req.requestId,
        },
        'Purchase recorded',
      );

      res.status(201).json({
        data: {
          transactionId: transaction.transaction_id,
          contractId: transaction.contract_id,
          status: transaction.status,
          createdAt: transaction.created_at,
        },
        message: 'Purchase recorded successfully',
      });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to record purchase');
      res.status(500).json({
        error: 'Failed to record purchase',
        message: error.message,
      });
    }
  });

  /**
   * GET /purchases/:transactionId
   * Get purchase details
   */
  router.get('/:transactionId', async (req, res) => {
    try {
      const { transactionId } = req.params;

      const transaction = await transactionService.getTransaction(transactionId);

      if (!transaction) {
        logger.warn({ transactionId, requestId: req.requestId }, 'Transaction not found');
        return res.status(404).json({ error: 'Transaction not found' });
      }

      const result = {
        transactionId: transaction.transaction_id,
        contractId: transaction.contract_id,
        buyerAddress: transaction.buyer_address,
        sharesPurchased: parseFloat(transaction.shares_purchased),
        pricePerShare: parseFloat(transaction.price_per_share),
        totalAmount: parseFloat(transaction.total_amount),
        totalAmountFormatted: `$${parseFloat(transaction.total_amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        paymentToken: transaction.payment_token,
        status: transaction.status,
        blockchainHash: transaction.blockchain_hash,
        createdAt: transaction.created_at,
        metadata: transaction.metadata || {},
      };

      logger.info({ transactionId, requestId: req.requestId }, 'Transaction details retrieved');
      res.json({ data: result });
    } catch (error) {
      logger.error({ error: error.message, requestId: req.requestId }, 'Failed to get transaction');
      res.status(500).json({
        error: 'Failed to retrieve transaction',
        message: error.message,
      });
    }
  });

  /**
   * GET /purchases/contract/:contractId
   * Get recent purchases for a specific asset
   *
   * Query:
   * - limit: number of records (default: 20, max: 100)
   * - offset: pagination offset (default: 0)
   */
  router.get('/contract/:contractId', async (req, res) => {
    try {
      const { contractId } = req.params;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = parseInt(req.query.offset) || 0;

      const transactions = await transactionService.getContractTransactions(
        contractId,
        limit,
        offset,
      );

      const result = transactions.map((tx) => ({
        transactionId: tx.transaction_id,
        buyerAddress: tx.buyer_address,
        sharesPurchased: parseFloat(tx.shares_purchased),
        pricePerShare: parseFloat(tx.price_per_share),
        totalAmount: parseFloat(tx.total_amount),
        totalAmountFormatted: `$${parseFloat(tx.total_amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        createdAt: tx.created_at,
      }));

      logger.info(
        {
          contractId,
          count: result.length,
          requestId: req.requestId,
        },
        'Contract purchases retrieved',
      );

      res.json({
        data: result,
        pagination: { limit, offset, count: result.length },
      });
    } catch (error) {
      logger.error(
        { error: error.message, requestId: req.requestId },
        'Failed to get contract purchases',
      );
      res.status(500).json({
        error: 'Failed to retrieve contract purchases',
        message: error.message,
      });
    }
  });

  return router;
}
