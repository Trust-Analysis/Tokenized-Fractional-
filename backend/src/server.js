// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/server.js — application entry point.
 * Imports the configured Express app, initialises optional services,
 * and starts listening on PORT.
 */

import { app } from './app.js';
import { logger } from './services/logger.js';
import { PORT } from './config.js';

// Initialise Redis cache client when not running tests
if (process.env.NODE_ENV !== 'test') {
  import('../cache.js').then(({ initClient }) => initClient()).catch(() => {});
}

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'RWA Off-chain Metadata Backend started');
});
