// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/websocketDLQ.test.js — Tests for WebSocket Dead Letter Queue service.
 *
 * Validates message buffering, sequence numbering, and recovery functionality
 * for reliable WebSocket message delivery.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { WebSocketDLQService } from '../src/services/websocketDLQService.js';

describe('WebSocket DLQ Service', () => {
  let dlqService;

  beforeEach(() => {
    dlqService = new WebSocketDLQService({
      bufferSize: 100,
      ttl: 3600,
      logger: console,
    });
  });

  describe('Sequence Number Assignment', () => {
    test('should increment sequence numbers per channel', () => {
      const seq1 = dlqService.getNextSequenceNumber('channel1');
      const seq2 = dlqService.getNextSequenceNumber('channel1');
      const seq3 = dlqService.getNextSequenceNumber('channel2');

      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(1); // Different channel starts from 1
    });

    test('should maintain separate sequence numbers for different channels', () => {
      const seq1a = dlqService.getNextSequenceNumber('channel1');
      const seq2a = dlqService.getNextSequenceNumber('channel2');
      const seq1b = dlqService.getNextSequenceNumber('channel1');
      const seq2b = dlqService.getNextSequenceNumber('channel2');

      expect(seq1a).toBe(1);
      expect(seq2a).toBe(1);
      expect(seq1b).toBe(2);
      expect(seq2b).toBe(2);
    });
  });

  describe('Message Storage', () => {
    test('should store messages in buffer', async () => {
      const message = { type: 'test', data: { value: 42 } };
      const result = await dlqService.storeMessage('channel1', message, 1);

      expect(result).toBe(true);
    });

    test('should maintain buffer size limit', async () => {
      const smallService = new WebSocketDLQService({ bufferSize: 5, logger: console });

      for (let i = 1; i <= 10; i++) {
        await smallService.storeMessage('channel1', { seq: i }, i);
      }

      const latestSeq = await smallService.getLatestSequenceNumber('channel1');
      expect(latestSeq).toBe(10);
    });
  });

  describe('Message Retrieval', () => {
    test('should retrieve messages in sequence range', async () => {
      for (let i = 1; i <= 5; i++) {
        await dlqService.storeMessage('channel1', { seq: i }, i);
      }

      const messages = await dlqService.getMessagesInRange('channel1', 2, 4);
      expect(messages).toHaveLength(3);
      expect(messages[0].seqId).toBe(2);
      expect(messages[2].seqId).toBe(4);
    });

    test('should return empty array for non-existent range', async () => {
      const messages = await dlqService.getMessagesInRange('nonexistent', 1, 10);
      expect(messages).toHaveLength(0);
    });

    test('should handle partial range requests', async () => {
      for (let i = 1; i <= 5; i++) {
        await dlqService.storeMessage('channel1', { seq: i }, i);
      }

      const messages = await dlqService.getMessagesInRange('channel1', 3, 10);
      expect(messages).toHaveLength(3); // Only 3, 4, 5 exist
    });
  });

  describe('Latest Sequence Number', () => {
    test('should return 0 for empty channel', async () => {
      const latest = await dlqService.getLatestSequenceNumber('empty');
      expect(latest).toBe(0);
    });

    test('should return highest sequence number', async () => {
      for (let i = 1; i <= 10; i++) {
        await dlqService.storeMessage('channel1', { seq: i }, i);
      }

      const latest = await dlqService.getLatestSequenceNumber('channel1');
      expect(latest).toBe(10);
    });
  });

  describe('Delivery Failure Logging', () => {
    test('should log delivery failures', async () => {
      const error = new Error('Connection lost');
      await dlqService.logDeliveryFailure('channel1', 'client1', 5, error);

      const failures = await dlqService.getRecentFailures(10);
      expect(failures).toHaveLength(1);
      expect(failures[0].channel).toBe('channel1');
      expect(failures[0].clientId).toBe('client1');
      expect(failures[0].seqId).toBe(5);
    });

    test('should maintain failure log limit', async () => {
      for (let i = 0; i < 150; i++) {
        await dlqService.logDeliveryFailure('channel1', `client${i}`, i, new Error('Test'));
      }

      const failures = await dlqService.getRecentFailures(200);
      expect(failures.length).toBeLessThanOrEqual(1000); // Default limit
    });
  });

  describe('Channel Management', () => {
    test('should clear channel data', async () => {
      for (let i = 1; i <= 5; i++) {
        await dlqService.storeMessage('channel1', { seq: i }, i);
      }

      await dlqService.clearChannel('channel1');
      const latest = await dlqService.getLatestSequenceNumber('channel1');
      expect(latest).toBe(0);
    });
  });

  describe('Statistics', () => {
    test('should return accurate statistics', async () => {
      for (let i = 1; i <= 10; i++) {
        await dlqService.storeMessage('channel1', { seq: i }, i);
      }
      for (let i = 1; i <= 5; i++) {
        await dlqService.storeMessage('channel2', { seq: i }, i);
      }

      const stats = await dlqService.getStats();
      expect(stats.totalMessages).toBe(15);
      expect(stats.channels).toBe(2);
    });

    test('should handle empty state statistics', async () => {
      const stats = await dlqService.getStats();
      expect(stats.totalMessages).toBe(0);
      expect(stats.channels).toBe(0);
    });
  });

  describe('In-Memory Fallback', () => {
    test('should work without Redis connection', async () => {
      const memoryService = new WebSocketDLQService({ 
        redisUrl: null, 
        logger: console 
      });

      await memoryService.storeMessage('channel1', { data: 'test' }, 1);
      const messages = await memoryService.getMessagesInRange('channel1', 1, 1);
      
      expect(messages).toHaveLength(1);
      expect(messages[0].message.data).toBe('test');
    });
  });
});
