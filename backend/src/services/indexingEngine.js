/**
 * Indexing Engine with Ledger Re-org Handling (#416)
 *
 * Tracks ledger_hash & previous_ledger_hash, detects chain divergence,
 * purges orphaned database events, resyncs the canonical chain, and signals 503 guard status.
 */

import { Worker } from 'worker_threads';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let reorgInProgress = false;

export function isReorgInProgress() {
  return reorgInProgress;
}

export function setReorgInProgress(status) {
  reorgInProgress = Boolean(status);
}

export class IndexingEngine {
  constructor() {
    this.chainHead = null;
    this.ledgerHistory = []; // Array of { sequence, ledger_hash, previous_ledger_hash, events }
    this.indexedEvents = []; // Database event records
    
    // Initialize worker pool
    this.workerPool = [];
    this.activeWorkers = 0;
    this.taskQueue = [];
    this.nextWorkerId = 0;
    this.nextTaskId = 0;
    this.pendingTasks = new Map();
    
    const numCores = os.cpus().length;
    for (let i = 0; i < numCores; i++) {
      const worker = new Worker(path.join(__dirname, 'xdrParserWorker.js'));
      worker.on('message', this.handleWorkerMessage.bind(this));
      worker.on('error', (err) => console.error(`Worker error:`, err));
      worker.on('exit', (code) => {
        if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
      });
      this.workerPool.push(worker);
    }
  }

  handleWorkerMessage(msg) {
    const { id, status, events, error } = msg;
    const task = this.pendingTasks.get(id);
    if (task) {
      if (status === 'SUCCESS') {
        task.resolve(events);
      } else {
        task.reject(new Error(error));
      }
      this.pendingTasks.delete(id);
    }
    
    this.activeWorkers--;
    this.processTaskQueue();
  }

  processTaskQueue() {
    if (this.taskQueue.length > 0 && this.activeWorkers < this.workerPool.length) {
      const task = this.taskQueue.shift();
      const worker = this.workerPool[this.nextWorkerId];
      this.nextWorkerId = (this.nextWorkerId + 1) % this.workerPool.length;
      
      this.activeWorkers++;
      this.pendingTasks.set(task.id, task);
      
      worker.postMessage({
        id: task.id,
        type: 'PARSE_BLOCK',
        sharedBuffer: task.sharedBuffer,
        byteLength: task.byteLength
      });
    }
  }

  parseBlockAsync(sharedBuffer, byteLength) {
    return new Promise((resolve, reject) => {
      const taskId = this.nextTaskId++;
      this.taskQueue.push({ id: taskId, sharedBuffer, byteLength, resolve, reject });
      this.processTaskQueue();
    });
  }

  /**
   * Process incoming ledger block
   */
  async processLedgerBlock(block) {
    const { sequence, ledger_hash, previous_ledger_hash, xdrBuffer, events = [] } = block;

    let parsedEvents = events;
    // Offload XDR decoding if buffer is provided
    if (xdrBuffer && xdrBuffer.buffer instanceof SharedArrayBuffer) {
      const decoded = await this.parseBlockAsync(xdrBuffer.buffer, xdrBuffer.byteLength);
      parsedEvents = parsedEvents.concat(decoded);
    }

    // Check for genesis or initial block
    if (!this.chainHead) {
      this.chainHead = block;
      this.ledgerHistory.push(block);
      this.indexedEvents.push(...parsedEvents.map((e) => ({ ...e, sequence, ledger_hash })));
      return { status: 'INDEXED', sequence };
    }

    // Detect ledger hash mismatch (Re-org detected!)
    if (this.chainHead.ledger_hash !== previous_ledger_hash) {
      return await this.handleLedgerReorg(block);
    }

    // Normal canonical block appending
    this.chainHead = block;
    this.ledgerHistory.push(block);
    this.indexedEvents.push(...parsedEvents.map((e) => ({ ...e, sequence, ledger_hash })));

    return { status: 'INDEXED', sequence };
  }

  /**
   * Handle ledger re-org divergence
   */
  async handleLedgerReorg(divergentBlock, newCanonicalChain = []) {
    setReorgInProgress(true);

    try {
      // Find common ancestor in ledger history matching divergent block's previous hash
      let commonAncestorSeq = null;
      for (let i = this.ledgerHistory.length - 1; i >= 0; i -= 1) {
        if (this.ledgerHistory[i].ledger_hash === divergentBlock.previous_ledger_hash) {
          commonAncestorSeq = this.ledgerHistory[i].sequence;
          break;
        }
      }

      // If no direct ancestor found in memory window, rollback to safest block before divergence
      if (commonAncestorSeq === null && this.ledgerHistory.length > 0) {
        commonAncestorSeq = Math.max(1, divergentBlock.sequence - 1);
      }

      // 1. Rollback orphaned ledgers & purge invalid database rows
      this.rollbackOrphanedLedgers(commonAncestorSeq);

      // 2. Re-sync new canonical chain blocks
      const chainToSync = newCanonicalChain.length > 0 ? newCanonicalChain : [divergentBlock];
      for (const block of chainToSync) {
        this.chainHead = block;
        this.ledgerHistory.push(block);
        
        let parsedEvents = block.events || [];
        if (block.xdrBuffer && block.xdrBuffer.buffer instanceof SharedArrayBuffer) {
           const decoded = await this.parseBlockAsync(block.xdrBuffer.buffer, block.xdrBuffer.byteLength);
           parsedEvents = parsedEvents.concat(decoded);
        }
        
        if (parsedEvents.length > 0) {
          this.indexedEvents.push(
            ...parsedEvents.map((e) => ({ ...e, sequence: block.sequence, ledger_hash: block.ledger_hash }))
          );
        }
      }

      return {
        status: 'REORG_HANDLED',
        commonAncestorSeq,
        canonicalHeadSeq: this.chainHead ? this.chainHead.sequence : null,
      };
    } finally {
      setReorgInProgress(false);
    }
  }

  /**
   * Delete events linked to orphaned ledgers
   */
  rollbackOrphanedLedgers(commonAncestorSeq) {
    // Purge orphaned ledger blocks from history
    this.ledgerHistory = this.ledgerHistory.filter((block) => block.sequence <= commonAncestorSeq);

    // Purge orphaned event records from database
    this.indexedEvents = this.indexedEvents.filter((event) => event.sequence <= commonAncestorSeq);

    // Reset chain head to common ancestor
    this.chainHead = this.ledgerHistory.length > 0 ? this.ledgerHistory[this.ledgerHistory.length - 1] : null;
  }

  getEvents() {
    return [...this.indexedEvents];
  }

  getLedgerHistory() {
    return [...this.ledgerHistory];
  }
}

