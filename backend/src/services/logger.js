// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/services/logger.js — pino logger singleton.
 * Exported as `logger` for use across all modules.
 */

import pino from 'pino';
import { LOG_LEVEL, NODE_ENV } from '../config.js';

const isDev = NODE_ENV === 'development';

export const logger = pino({
  level: LOG_LEVEL,
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, ignore: 'pid,hostname' },
    },
  }),
});
