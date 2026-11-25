// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/sorobanMetadataService.js — Soroban Smart Contract Metadata Storage
 *
 * Implements Issue #516 acceptance criteria:
 * - Store the resulting CID (Content Identifier) on the Soroban smart contract.
 *
 * Invokes `set_metadata_uri(uri: Bytes)` on the RwaMarketplace Soroban smart contract,
 * associating the decentralized IPFS metadata URI (`ipfs://<CID>`) with the asset on-chain.
 */

import { Contract, Keypair, Networks, rpc, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { setTimeout as delay } from 'node:timers/promises';
import { logger } from './logger.js';

const RPC_TIMEOUT_MS = 10_000;
const RPC_MAX_RETRIES = 2;

// In-memory or simulated contract metadata store for environments where
// live Soroban RPC is offline or running under unit tests
const contractMetadataStore = new Map();

async function withRpcRetry(operation, attempt = 0) {
  try {
    return await operation();
  } catch (err) {
    const status = err.response?.status ?? err.status;
    const retryable =
      !Number.isInteger(err.code) &&
      (status === undefined || status === 408 || status === 429 || status >= 500);
    if (!retryable || attempt >= RPC_MAX_RETRIES) throw err;
    await delay(250 * 2 ** attempt);
    return withRpcRetry(operation, attempt + 1);
  }
}

/**
 * Store the resulting IPFS CID on the Soroban smart contract.
 *
 * @param {Object} params
 * @param {string} params.contractId - Soroban smart contract address (C...)
 * @param {string} params.cid - IPFS CID string (v0 or v1)
 * @param {string} [params.uri] - Optional full IPFS URI (e.g. ipfs://bafy...)
 * @returns {Promise<Object>} Result of on-chain metadata transaction
 */
export async function storeMetadataCidOnContract({ contractId, cid, uri = null }) {
  if (!contractId || typeof contractId !== 'string') {
    throw new Error('Valid contractId is required to store metadata on Soroban');
  }
  if (!cid && !uri) {
    throw new Error('IPFS CID or URI is required to store metadata on Soroban');
  }

  const finalUri = uri || (cid.startsWith('ipfs://') ? cid : `ipfs://${cid}`);
  const rpcUrl = process.env.SOROBAN_RPC_URL || process.env.VITE_RPC_URL;
  const adminSecret = process.env.SOROBAN_ADMIN_SECRET || process.env.ADMIN_SECRET_KEY;

  // Execute a real contract invocation only when RPC credentials are configured.
  if (rpcUrl && adminSecret) {
    try {
      const networkPassphrase = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
      const server = new rpc.Server(rpcUrl, {
        allowHttp: process.env.SOROBAN_RPC_ALLOW_HTTP === 'true',
      });
      // These defaults select the SDK's bounded fetch adapter, which aborts via AbortSignal.timeout().
      server.httpClient.defaults.timeout = RPC_TIMEOUT_MS;
      server.httpClient.defaults.maxRedirects = 0;
      server.httpClient.defaults.maxContentLength = 1024 * 1024;
      const adminKeypair = Keypair.fromSecret(adminSecret);
      const contract = new Contract(contractId);

      const account = await withRpcRetry(() => server.getAccount(adminKeypair.publicKey()));
      const uriBytes = Buffer.from(finalUri, 'utf-8');

      const tx = new TransactionBuilder(account, {
        fee: '10000',
        networkPassphrase,
      })
        .addOperation(contract.call('set_metadata_uri', xdr.ScVal.scvBytes(uriBytes)))
        // Ledger validity window; HTTP requests are bounded by RPC_TIMEOUT_MS above.
        .setTimeout(30)
        .build();

      const simulation = await withRpcRetry(() => server.simulateTransaction(tx));
      if (simulation.error) {
        throw new Error(`Simulation failed: ${simulation.error}`);
      }

      const preparedTx = rpc.assembleTransaction(tx, simulation).build();
      preparedTx.sign(adminKeypair);
      const sendResult = await withRpcRetry(() => server.sendTransaction(preparedTx));
      if (sendResult.status === 'ERROR') {
        throw new Error(
          `Soroban rejected transaction: ${sendResult.errorResult || 'unknown error'}`,
        );
      }

      contractMetadataStore.set(contractId, {
        contractId,
        cid: cid.replace(/^ipfs:\/\//, ''),
        uri: finalUri,
        storedAt: new Date().toISOString(),
      });

      logger.info(
        { contractId, cid, uri: finalUri, txHash: sendResult.hash },
        'Stored IPFS metadata CID on Soroban smart contract via RPC',
      );

      return {
        success: true,
        contractId,
        cid,
        uri: finalUri,
        txHash: sendResult.hash,
        onChain: true,
      };
    } catch (err) {
      logger.warn({ contractId, error: err.message }, 'Live Soroban RPC metadata write failed');
      return {
        success: false,
        contractId,
        cid,
        uri: finalUri,
        onChain: false,
        warning: `RPC unavailable: ${err.message}`,
      };
    }
  }

  // Local mode is explicitly not represented as an on-chain write.
  logger.info(
    { contractId, cid, uri: finalUri },
    'Soroban metadata write skipped because RPC credentials are not configured',
  );

  return {
    success: false,
    contractId,
    cid: cid.replace(/^ipfs:\/\//, ''),
    uri: finalUri,
    onChain: false,
    simulated: true,
    warning: 'Soroban RPC credentials are not configured; metadata CID was not written on-chain',
  };
}

/**
 * Retrieve metadata URI associated with contract
 *
 * @param {string} contractId
 * @returns {Promise<string|null>}
 */
export async function getMetadataUriFromContract(contractId) {
  const entry = contractMetadataStore.get(contractId);
  return entry ? entry.uri : null;
}
