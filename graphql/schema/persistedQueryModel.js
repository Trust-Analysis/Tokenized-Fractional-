/**
 * GraphQL Persisted Query Data Model
 * Defines the structure for storing and managing persisted queries
 */

export const PERSISTED_QUERY_SCHEMA = {
  // Persisted query collection
  persistedQueries: {
    id: String,                    // Unique query ID (UUID or hash-based)
    hash: String,                  // SHA-256 hash of query string
    operationName: String,         // GraphQL operation name
    queryString: String,           // The actual GraphQL query
    description: String,           // Human-readable description
    category: String,              // Query category (e.g., "assets", "portfolio")
    
    // Metadata
    createdAt: Date,
    createdBy: String,             // User ID who created
    updatedAt: Date,
    updatedBy: String,
    
    // Versioning
    version: Number,               // Current version number
    previousVersions: Array,       // Array of previous versions
    
    // Analysis & Optimization
    complexity: Number,            // Query complexity score
    maxDepth: Number,              // Maximum query depth
    fieldCount: Number,            // Number of fields requested
    estimatedCost: Number,         // Estimated execution cost
    
    // Analytics
    executionCount: Number,        // Total number of executions
    averageExecutionTime: Number,  // Average execution time in ms
    cacheHitRate: Number,          // Cache hit percentage
    errorCount: Number,            // Number of errors
    
    // Status & Settings
    isActive: Boolean,             // Whether query is active
    isDeprecated: Boolean,         // Whether query is deprecated
    deprecationReason: String,     // Why it's deprecated
    requiresAuthentication: Boolean, // Auth requirement
    allowedRoles: Array,           // Array of allowed role names
    
    // Performance & Security
    maxExecutionTimeMs: Number,    // Max allowed execution time
    cacheStrategy: String,         // "no-cache", "short", "long", "permanent"
    cacheTTL: Number,              // Cache TTL in seconds
    
    // Metadata for tracking
    tags: Array,                   // Array of tags for filtering
    documentation: String,         // Extended documentation
    exampleVariables: Object,      // Example variables for the query
  },

  // Query versions (historical tracking)
  queryVersions: {
    id: String,                    // Unique version ID
    queryId: String,               // Reference to parent query
    version: Number,               // Version number
    queryString: String,           // Query at this version
    complexity: Number,
    maxDepth: Number,
    fieldCount: Number,
    estimatedCost: Number,
    changelog: String,             // What changed in this version
    createdAt: Date,
    createdBy: String,
    replacedAt: Date,              // When this version was replaced
    isActive: Boolean,
  },

  // Query execution logs
  queryExecutionLog: {
    id: String,                    // Unique log entry ID
    queryId: String,               // Reference to persisted query
    executionTime: Number,         // Time in milliseconds
    resultSize: Number,            // Size of result in bytes
    cacheHit: Boolean,             // Whether result was cached
    executedAt: Date,
    userId: String,                // Who executed it
    variables: Object,             // Query variables (sanitized)
    errorMessage: String,          // Error message if failed
    status: String,                // "success", "error", "timeout"
  },

  // Query performance metrics
  queryMetrics: {
    id: String,
    queryId: String,
    timestamp: Date,
    executionCount: Number,
    averageExecutionTime: Number,
    minExecutionTime: Number,
    maxExecutionTime: Number,
    errorCount: Number,
    errorRate: Number,
    cacheHitCount: Number,
    cacheHitRate: Number,
    distinctUserCount: Number,
    totalBytesReturned: Number,
    avgBytesReturned: Number,
  },

  // Query dependencies (what queries depend on this data)
  queryDependencies: {
    id: String,
    queryId: String,
    dependsOn: Array,              // Array of other query IDs or data types
    dependentQueries: Array,       // Array of queries that depend on this
    dataTypes: Array,              // Data types accessed (e.g., ["Asset", "Portfolio"])
  },

  // Query deprecation tracking
  queryDeprecations: {
    id: String,
    queryId: String,
    deprecationDate: Date,
    removalDate: Date,             // Planned removal date
    replacement: String,           // ID of replacement query if available
    reason: String,
    announcement: String,          // Announcement text for users
    notificationsSent: Boolean,
  },
};

/**
 * Create persisted query record
 */
export function createPersistedQueryRecord(queryString, metadata = {}) {
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha256').update(queryString).digest('hex');

  return {
    id: metadata.id || generateId(),
    hash,
    operationName: metadata.operationName || 'Query',
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
    
    // Analysis
    complexity: metadata.complexity || 0,
    maxDepth: metadata.maxDepth || 0,
    fieldCount: metadata.fieldCount || 0,
    estimatedCost: metadata.estimatedCost || 0,
    
    // Analytics
    executionCount: 0,
    averageExecutionTime: 0,
    cacheHitRate: 0,
    errorCount: 0,
    
    // Status
    isActive: metadata.isActive !== false,
    isDeprecated: metadata.isDeprecated || false,
    deprecationReason: metadata.deprecationReason || '',
    requiresAuthentication: metadata.requiresAuthentication || false,
    allowedRoles: metadata.allowedRoles || [],
    
    // Performance
    maxExecutionTimeMs: metadata.maxExecutionTimeMs || 5000,
    cacheStrategy: metadata.cacheStrategy || 'short',
    cacheTTL: metadata.cacheTTL || 300,
    
    // Metadata
    tags: metadata.tags || [],
    documentation: metadata.documentation || '',
    exampleVariables: metadata.exampleVariables || {},
  };
}

/**
 * Create query version record
 */
export function createQueryVersionRecord(queryId, queryString, metadata = {}) {
  return {
    id: generateId(),
    queryId,
    version: metadata.version || 1,
    queryString,
    complexity: metadata.complexity || 0,
    maxDepth: metadata.maxDepth || 0,
    fieldCount: metadata.fieldCount || 0,
    estimatedCost: metadata.estimatedCost || 0,
    changelog: metadata.changelog || '',
    createdAt: new Date(),
    createdBy: metadata.createdBy || 'system',
    replacedAt: null,
    isActive: true,
  };
}

/**
 * Create execution log entry
 */
export function createExecutionLogEntry(queryId, executionData = {}) {
  return {
    id: generateId(),
    queryId,
    executionTime: executionData.executionTime || 0,
    resultSize: executionData.resultSize || 0,
    cacheHit: executionData.cacheHit || false,
    executedAt: new Date(),
    userId: executionData.userId || 'anonymous',
    variables: executionData.variables || {},
    errorMessage: executionData.errorMessage || '',
    status: executionData.status || 'success',
  };
}

/**
 * Create metrics record
 */
export function createMetricsRecord(queryId, metricsData = {}) {
  return {
    id: generateId(),
    queryId,
    timestamp: new Date(),
    executionCount: metricsData.executionCount || 0,
    averageExecutionTime: metricsData.averageExecutionTime || 0,
    minExecutionTime: metricsData.minExecutionTime || 0,
    maxExecutionTime: metricsData.maxExecutionTime || 0,
    errorCount: metricsData.errorCount || 0,
    errorRate: metricsData.errorRate || 0,
    cacheHitCount: metricsData.cacheHitCount || 0,
    cacheHitRate: metricsData.cacheHitRate || 0,
    distinctUserCount: metricsData.distinctUserCount || 0,
    totalBytesReturned: metricsData.totalBytesReturned || 0,
    avgBytesReturned: metricsData.avgBytesReturned || 0,
  };
}

/**
 * Helper to generate unique IDs
 */
function generateId() {
  return require('crypto').randomUUID();
}

export default {
  PERSISTED_QUERY_SCHEMA,
  createPersistedQueryRecord,
  createQueryVersionRecord,
  createExecutionLogEntry,
  createMetricsRecord,
};
