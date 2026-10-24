#!/usr/bin/env node

// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * bootstrap-api-key.js — Create the first admin API key
 * 
 * Usage:
 *   node bootstrap-api-key.js
 *   NODE_ENV=production node bootstrap-api-key.js
 */

import 'dotenv/config';
import { initDatabase, closeDatabase } from './src/services/database.js';
import { createApiKeyService } from './src/services/apiKeyService.js';
import { logger } from './src/services/logger.js';

const environment = process.env.NODE_ENV || 'development';

(async () => {
  try {
    console.log(`\n🔧 Bootstrapping API key for ${environment} environment...\n`);
    
    // Initialize database and run migrations
    const db = await initDatabase(environment);
    logger.info('Database initialized');
    
    // Create API key service
    const apiKeyService = createApiKeyService(db, logger);
    
    // Create the initial admin key (valid for 1 year)
    const result = await apiKeyService.create({
      name: 'Bootstrap Admin Key',
      description: `Initial admin key for ${environment} environment`,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
    
    console.log('✅ API key created successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 Store this key securely. You will not be able to see it again.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log(`Key ID:     ${result.id}`);
    console.log(`Key:        ${result.key}`);
    console.log(`Name:       ${result.name}`);
    console.log(`Created:    ${result.createdAt}`);
    console.log(`Expires:    ${result.expiresAt}`);
    console.log();
    
    console.log('📋 Usage Examples:\n');
    
    console.log('1. Verify API key:');
    console.log(`   curl -H "x-api-key: ${result.key}" http://localhost:3001/api/admin/verify\n`);
    
    console.log('2. Create a new API key:');
    console.log(`   curl -X POST http://localhost:3001/api/v1/api-keys \\`);
    console.log(`     -H "x-api-key: ${result.key}" \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"name": "Production Key", "expiresAt": "2027-12-31T23:59:59Z"}'\n`);
    
    console.log('3. List all API keys:');
    console.log(`   curl -H "x-api-key: ${result.key}" http://localhost:3001/api/v1/api-keys\n`);
    
    console.log('🔒 Next Steps:\n');
    console.log('1. Copy the key above to a secure location (password manager, secrets vault, etc.)');
    console.log('2. Set it as an environment variable or pass it as a header in API calls');
    console.log('3. Create additional keys for different services/environments using the API');
    console.log('4. Rotate keys regularly (at least every 90 days)');
    console.log('5. Monitor key usage and revoke unused keys\n');
    
    console.log('📚 For more information, see: docs/API_KEY_MANAGEMENT.md\n');
    
    await closeDatabase();
    process.exit(0);
  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'Bootstrap failed');
    console.error('\n❌ Error creating API key:');
    console.error(`   ${error.message}\n`);
    process.exit(1);
  }
})();
