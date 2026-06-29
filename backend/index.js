// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * backend/index.js — backward-compatibility shim.
 *
 * The application has been split into the src/ directory (issue #122).
 * This file re-exports the public API so that existing tests and any
 * external tooling that imports from `index.js` continues to work unchanged.
 *
 * New code should import directly from the relevant src/ module.
 */

export { app } from './src/app.js';
export { logger } from './src/services/logger.js';
export { validateContractId, validateRwaBody } from './src/validators/rwaValidator.js';
export { tokenize, buildSearchIndex, scoreSearch, syncSearchIndex } from './src/services/dataService.js';
