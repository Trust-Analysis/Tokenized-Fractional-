// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * src/server.js — application entry point.
 * Imports the configured Express app, initialises optional services,
 * and starts listening on PORT.
 */

import { app, initializeApp } from './app.js';
import { logger } from './services/logger.js';
import { PORT, NODE_ENV } from './config.js';

// Initialise the app (database, services, etc.)
await initializeApp();

// Initialise Redis cache client when not running tests
if (NODE_ENV !== 'test') {
  import('../cache.js').then(({ initClient }) => initClient()).catch(() => {});
}

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'RWA Off-chain Metadata Backend started');
});
