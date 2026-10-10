/**
 * GraphQL Query Registration Workflow
 * Handles registration, validation, and storage of persisted queries
 */

import crypto from 'crypto';
import { parse, buildSchema, buildClientSchema } from 'graphql';
import { Logger } from '../utils/logger.js';

const logger = new Logger('QueryRegistration');

/**
 * Query Registration Manager
 */
export class QueryRegistrationManager {
  constructor(store, analyzer) {
    this.store = store;
    this.analyzer = analyzer;
    this.registrationQueue = [];
    this.validationCache = new Map();
  }

  /**
   * Register a new persisted query
   */
  async registerQuery(queryString, metadata = {}) {
    try {
      logger.info('Registering query', { operationName: metadata.operationName });

      // Validation steps
      const validationResult = await this.validateQuery(queryString, metadata);
      if (!validationResult.isValid) {
        return {
          success: false,
          error: validationResult.error,
          code: 'VALIDATION_FAILED',
        };
      }

      // Calculate hash
      const hash = this.calculateHash(queryString);

      // Check if query already exists
      const existingQuery = await this.store.getQueryByHash(hash);
      if (existingQuery) {
        return {
          success: false,
          error: 'Query already registered',
          code: 'QUERY_EXISTS',
          queryId: existingQuery.id,
          hash,
        };
      }

      // Analyze query
      const analysis = await this.analyzer.analyzeQuery(queryString, this.analyzer.schema);

      // Create query record
      const queryRecord = {
        id: this.generateQueryId(),
        hash,
        operationName: validationResult.operationName,
        queryString,
        description: metadata.description || '',
        category: metadata.category || 'default',
        
        // Metadata
        createdAt: new Date(),
        createdBy: metadata.createdBy || 'system',
        updatedAt: new Date(),
        updatedBy: metadata.createdBy || 'system',
        
        // Versioning
        version: 1,
        previousVersions: [],
        
        // Analysis results
        complexity: analysis.complexity,
        maxDepth: analysis.maxDepth,
        fieldCount: analysis.fieldCount,
        estimatedCost: analysis.estimatedCost,
        variables: validationResult.variables,
        
        // Status
        isActive: true,
        isDeprecated: false,
        requiresAuthentication: metadata.requiresAuthentication || false,
        allowedRoles: metadata.allowedRoles || [],
        
        // Performance settings
        maxExecutionTimeMs: metadata.maxExecutionTimeMs || 5000,
        cacheStrategy: metadata.cacheStrategy || 'short',
        cacheTTL: metadata.cacheTTL || 300,
        
        // Analytics
        executionCount: 0,
        averageExecutionTime: 0,
        cacheHitRate: 0,
        errorCount: 0,
        
        // Metadata
        tags: metadata.tags || [],
        documentation: metadata.documentation || '',
        exampleVariables: metadata.exampleVariables || {},
      };

      // Store query
      const stored = await this.store.saveQuery(queryRecord);

      logger.info('Query registered successfully', { queryId: queryRecord.id, hash });

      return {
        success: true,
        queryId: queryRecord.id,
        hash,
        queryRecord,
        analysis,
      };
    } catch (error) {
      logger.error('Query registration failed', { error: error.message });
      return {
        success: false,
        error: error.message,
        code: 'REGISTRATION_ERROR',
      };
    }
  }

  /**
   * Validate query before registration
   */
  async validateQuery(queryString, metadata = {}) {
    try {
      // Parse GraphQL query
      const document = parse(queryString);

      if (!document.definitions || document.definitions.length === 0) {
        return {
          isValid: false,
          error: 'Invalid GraphQL query: no definitions',
        };
      }

      // Extract operation information
      const definition = document.definitions[0];
      if (definition.kind !== 'OperationDefinition') {
        return {
          isValid: false,
          error: 'Query must be an operation definition',
        };
      }

      const operationName = definition.name?.value || 'Query';
      const operationType = definition.operation; // query, mutation, subscription

      // Validate operation type
      if (!['query', 'mutation', 'subscription'].includes(operationType)) {
        return {
          isValid: false,
          error: `Invalid operation type: ${operationType}`,
        };
      }

      // Extract variables
      const variables = definition.variableDefinitions?.map(v => ({
        name: v.variable.name.value,
        type: this.extractTypeName(v.type),
        required: v.type.kind === 'NonNullType',
      })) || [];

      // Check query size (prevent huge queries)
      if (queryString.length > 10000) {
        return {
          isValid: false,
          error: 'Query exceeds maximum size (10KB)',
        };
      }

      // Check for mutations
      if (operationType === 'mutation' && !metadata.allowMutations) {
        return {
          isValid: false,
          error: 'Mutations are not allowed in persisted queries',
        };
      }

      logger.info('Query validation successful', { operationName });

      return {
        isValid: true,
        operationName,
        operationType,
        variables,
        variableCount: variables.length,
      };
    } catch (error) {
      logger.error('Query validation error', { error: error.message });
      return {
        isValid: false,
        error: error.message,
      };
    }
  }

  /**
   * Update existing persisted query (creates new version)
   */
  async updateQuery(queryId, newQueryString, metadata = {}) {
    try {
      logger.info('Updating query', { queryId });

      // Get existing query
      const existingQuery = await this.store.getQuery(queryId);
      if (!existingQuery) {
        return {
          success: false,
          error: 'Query not found',
          code: 'NOT_FOUND',
        };
      }

      // Validate new query
      const validationResult = await this.validateQuery(newQueryString, metadata);
      if (!validationResult.isValid) {
        return {
          success: false,
          error: validationResult.error,
          code: 'VALIDATION_FAILED',
        };
      }

      // Check if query actually changed
      if (existingQuery.queryString === newQueryString) {
        return {
          success: false,
          error: 'Query content is identical',
          code: 'NO_CHANGE',
        };
      }

      // Analyze new query
      const newAnalysis = await this.analyzer.analyzeQuery(newQueryString, this.analyzer.schema);

      // Save current version as previous
      const versionRecord = {
        id: this.generateQueryId(),
        queryId,
        version: existingQuery.version,
        queryString: existingQuery.queryString,
        complexity: existingQuery.complexity,
        maxDepth: existingQuery.maxDepth,
        fieldCount: existingQuery.fieldCount,
        estimatedCost: existingQuery.estimatedCost,
        changelog: metadata.changelog || '',
        createdAt: existingQuery.createdAt,
        createdBy: existingQuery.createdBy,
        replacedAt: new Date(),
        isActive: false,
      };

      await this.store.saveQueryVersion(versionRecord);

      // Update query record
      const updatedQuery = {
        ...existingQuery,
        queryString: newQueryString,
        version: existingQuery.version + 1,
        complexity: newAnalysis.complexity,
        maxDepth: newAnalysis.maxDepth,
        fieldCount: newAnalysis.fieldCount,
        estimatedCost: newAnalysis.estimatedCost,
        updatedAt: new Date(),
        updatedBy: metadata.updatedBy || 'system',
        previousVersions: [
          ...existingQuery.previousVersions,
          versionRecord.id,
        ],
      };

      await this.store.updateQuery(queryId, updatedQuery);

      logger.info('Query updated successfully', {
        queryId,
        newVersion: updatedQuery.version,
      });

      return {
        success: true,
        queryId,
        version: updatedQuery.version,
        queryRecord: updatedQuery,
      };
    } catch (error) {
      logger.error('Query update failed', { error: error.message });
      return {
        success: false,
        error: error.message,
        code: 'UPDATE_ERROR',
      };
    }
  }

  /**
   * Deprecate a query
   */
  async deprecateQuery(queryId, reason, replacementQueryId) {
    try {
      logger.info('Deprecating query', { queryId, replacementQueryId });

      const query = await this.store.getQuery(queryId);
      if (!query) {
        return { success: false, error: 'Query not found' };
      }

      const deprecationRecord = {
        id: this.generateQueryId(),
        queryId,
        deprecationDate: new Date(),
        removalDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
        replacement: replacementQueryId,
        reason,
        announcement: '',
        notificationsSent: false,
      };

      await this.store.saveDeprecation(deprecationRecord);

      const updated = {
        ...query,
        isDeprecated: true,
        deprecationReason: reason,
      };

      await this.store.updateQuery(queryId, updated);

      logger.info('Query deprecated successfully', { queryId });

      return {
        success: true,
        deprecationRecord,
      };
    } catch (error) {
      logger.error('Query deprecation failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate SHA-256 hash of query
   */
  calculateHash(queryString) {
    // Normalize query string (remove extra whitespace)
    const normalized = queryString.replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Generate unique query ID
   */
  generateQueryId() {
    return crypto.randomUUID();
  }

  /**
   * Extract type name from GraphQL type
   */
  extractTypeName(type) {
    if (type.kind === 'NonNullType') {
      return this.extractTypeName(type.type) + '!';
    }
    if (type.kind === 'ListType') {
      return '[' + this.extractTypeName(type.type) + ']';
    }
    return type.name?.value || 'Unknown';
  }

  /**
   * Batch register multiple queries
   */
  async batchRegisterQueries(queries) {
    const results = [];

    for (const query of queries) {
      const result = await this.registerQuery(query.queryString, query.metadata);
      results.push(result);
    }

    return {
      success: results.every(r => r.success),
      results,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
    };
  }

  /**
   * Validate query against schema
   */
  async validateQueryAgainstSchema(queryString, schema) {
    try {
      const document = parse(queryString);
      const errors = require('graphql').validate(schema, document);

      if (errors.length > 0) {
        return {
          isValid: false,
          errors: errors.map(e => ({
            message: e.message,
            locations: e.locations,
          })),
        };
      }

      return { isValid: true, errors: [] };
    } catch (error) {
      return {
        isValid: false,
        errors: [{ message: error.message }],
      };
    }
  }
}

export default QueryRegistrationManager;
