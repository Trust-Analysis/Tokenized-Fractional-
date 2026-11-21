// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

export class FlashLoanProtectionService {
  constructor(logger = console) {
    this.logger = logger;
    this.recentTrades = []; // { caller, assetId, timestamp, blockNumber, shares, price }
    this.config = {
      enabled: true,
      minBlockInterval: 2, // minimum blocks between consecutive high-volume trades from same origin
      maxSingleBlockVolumePct: 15, // max % of total asset shares that can be bought in 1 block
      maxOraclePriceDriftPct: 5, // max % price deviation allowed vs external oracle
      overrideActive: false,
    };
    this.protectionLogs = [];
  }

  getConfig() {
    return { ...this.config };
  }

  updateConfig(updates = {}) {
    this.config = {
      ...this.config,
      ...updates,
    };
    this.logger.info({ config: this.config }, 'Flash loan protection config updated');
    return this.config;
  }

  /**
   * Log protection trigger event
   */
  logProtectionEvent(type, details) {
    const entry = {
      id: `flp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      type,
      details,
      timestamp: new Date().toISOString(),
    };
    this.protectionLogs.unshift(entry);
    if (this.protectionLogs.length > 500) {
      this.protectionLogs.pop();
    }
    this.logger.warn({ entry }, 'Flash loan protection triggered');
    return entry;
  }

  /**
   * Validate incoming transaction for potential Flash Loan manipulation
   */
  validateTransaction({ caller, assetId, shares, price, totalShares = 1000, currentBlock = 1, oraclePrice = price }) {
    if (!this.config.enabled || this.config.overrideActive) {
      return { allowed: true, reason: 'Protection bypassed or disabled' };
    }

    const now = Date.now();

    // 1. Single Block Volume Check (% of total supply)
    const shareVolumePct = (shares / (totalShares || 1)) * 100;
    if (shareVolumePct > this.config.maxSingleBlockVolumePct) {
      this.logProtectionEvent('EXCESSIVE_SINGLE_BLOCK_VOLUME', {
        caller,
        assetId,
        shares,
        shareVolumePct,
        maxAllowedPct: this.config.maxSingleBlockVolumePct,
      });
      return {
        allowed: false,
        reason: `Transaction volume (${shareVolumePct.toFixed(1)}%) exceeds maximum single-block limit (${this.config.maxSingleBlockVolumePct}%)`,
      };
    }

    // 2. Rapid Origin Re-entrancy / Same Block Cooldown
    const lastTrade = this.recentTrades.find(
      t => t.caller === caller && t.assetId === assetId
    );

    if (lastTrade) {
      const blockDiff = currentBlock - lastTrade.blockNumber;
      if (blockDiff < this.config.minBlockInterval) {
        this.logProtectionEvent('RAPID_SAME_ORIGIN_TRADE', {
          caller,
          assetId,
          blockDiff,
          minRequired: this.config.minBlockInterval,
        });
        return {
          allowed: false,
          reason: `High frequency trade detected. ${this.config.minBlockInterval - blockDiff} more block(s) required between transactions`,
        };
      }
    }

    // 3. Oracle Price Manipulation / Drift Check
    if (oraclePrice && price) {
      const driftPct = Math.abs((price - oraclePrice) / oraclePrice) * 100;
      if (driftPct > this.config.maxOraclePriceDriftPct) {
        this.logProtectionEvent('ORACLE_PRICE_DRIFT', {
          caller,
          assetId,
          price,
          oraclePrice,
          driftPct,
          maxAllowed: this.config.maxOraclePriceDriftPct,
        });
        return {
          allowed: false,
          reason: `Price drift (${driftPct.toFixed(1)}%) exceeds oracle safety threshold (${this.config.maxOraclePriceDriftPct}%)`,
        };
      }
    }

    // Record trade
    this.recentTrades.unshift({ caller, assetId, timestamp: now, blockNumber: currentBlock, shares, price });
    if (this.recentTrades.length > 200) this.recentTrades.pop();

    return { allowed: true, reason: 'Passed all protection checks' };
  }

  getLogs(limit = 50) {
    return this.protectionLogs.slice(0, limit);
  }
}

export const createFlashLoanProtectionService = (logger) => new FlashLoanProtectionService(logger);
