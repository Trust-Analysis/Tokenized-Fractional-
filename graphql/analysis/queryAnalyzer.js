/**
 * Query Analysis and Optimization Engine
 * Analyzes queries for complexity, depth, and optimization opportunities
 */

import { parse, visit } from 'graphql';
import { Logger } from '../utils/logger.js';

const logger = new Logger('QueryAnalyzer');

/**
 * Query Analyzer - Analyzes GraphQL queries for complexity and optimization
 */
export class QueryAnalyzer {
  constructor(schema) {
    this.schema = schema;
    this.complexityScores = new Map();
    this.fieldCosts = new Map();
  }

  /**
   * Analyze a query and return metrics
   */
  async analyzeQuery(queryString, schema = this.schema) {
    try {
      const document = parse(queryString);

      const analysis = {
        complexity: 0,
        maxDepth: 0,
        fieldCount: 0,
        estimatedCost: 0,
        recommendations: [],
        potentialIssues: [],
        fieldBreakdown: [],
      };

      // Visitor to traverse and analyze the query
      const visitor = {
        Field: (node, key, parent, path, ancestors) => {
          analysis.fieldCount++;

          const depth = ancestors.length;
          if (depth > analysis.maxDepth) {
            analysis.maxDepth = depth;
          }

          // Track field information
          const fieldName = node.name.value;
          const fieldCost = this.calculateFieldCost(fieldName);
          analysis.complexity += fieldCost;
          analysis.estimatedCost += fieldCost;

          analysis.fieldBreakdown.push({
            name: fieldName,
            depth,
            cost: fieldCost,
          });
        },

        FragmentSpread: (node) => {
          // Account for fragments
          analysis.complexity += 10;
        },

        Variable: (node) => {
          // Variables add minimal complexity
          analysis.complexity += 1;
        },
      };

      visit(document, visitor);

      // Generate recommendations
      analysis.recommendations = this.generateRecommendations(analysis);

      // Check for potential issues
      analysis.potentialIssues = this.checkForIssues(analysis);

      logger.info('Query analysis complete', {
        complexity: analysis.complexity,
        maxDepth: analysis.maxDepth,
        fieldCount: analysis.fieldCount,
      });

      return analysis;
    } catch (error) {
      logger.error('Query analysis failed', { error: error.message });
      return {
        complexity: 0,
        maxDepth: 0,
        fieldCount: 0,
        estimatedCost: 0,
        recommendations: [],
        potentialIssues: [{ severity: 'error', message: error.message }],
        fieldBreakdown: [],
      };
    }
  }

  /**
   * Calculate field cost based on type
   */
  calculateFieldCost(fieldName) {
    // Cost multipliers for different field types
    const costMap = {
      // Low cost fields
      'id': 1,
      'name': 1,
      'title': 1,
      'description': 1,
      'status': 1,
      'createdAt': 1,
      'updatedAt': 1,

      // Medium cost fields
      'users': 50,
      'assets': 50,
      'portfolios': 50,
      'transactions': 50,

      // High cost fields
      'search': 100,
      'analytics': 100,
      'statistics': 100,
      'reports': 100,

      // Very high cost fields
      'deepSearch': 500,
      'aggregations': 500,
    };

    return costMap[fieldName] || 10; // Default cost
  }

  /**
   * Generate optimization recommendations
   */
  generateRecommendations(analysis) {
    const recommendations = [];

    // Check query depth
    if (analysis.maxDepth > 5) {
      recommendations.push({
        severity: 'warning',
        message: `Query depth ${analysis.maxDepth} exceeds recommended maximum of 5`,
        suggestion: 'Consider breaking query into multiple requests or using fragments',
      });
    }

    // Check field count
    if (analysis.fieldCount > 50) {
      recommendations.push({
        severity: 'warning',
        message: `Query requests ${analysis.fieldCount} fields, consider requesting only needed fields`,
        suggestion: 'Remove unnecessary fields to reduce payload size',
      });
    }

    // Check complexity
    if (analysis.complexity > 1000) {
      recommendations.push({
        severity: 'error',
        message: 'Query complexity exceeds safe threshold',
        suggestion: 'Simplify the query or split into multiple requests',
      });
    }

    // Suggest caching
    if (analysis.complexity < 100 && analysis.fieldCount < 20) {
      recommendations.push({
        severity: 'info',
        message: 'Query is simple and benefits from aggressive caching',
        suggestion: 'Use "long" cache strategy with 1 hour TTL',
      });
    }

    return recommendations;
  }

  /**
   * Check for potential query issues
   */
  checkForIssues(analysis) {
    const issues = [];

    if (analysis.maxDepth === 0) {
      issues.push({
        severity: 'error',
        message: 'Query has no fields',
      });
    }

    if (analysis.fieldCount === 0) {
      issues.push({
        severity: 'error',
        message: 'No fields found in query',
      });
    }

    if (analysis.complexity > 5000) {
      issues.push({
        severity: 'error',
        message: 'Query complexity is dangerously high',
      });
    }

    if (analysis.maxDepth > 20) {
      issues.push({
        severity: 'error',
        message: 'Query nesting depth exceeds safe limit',
      });
    }

    return issues;
  }

  /**
   * Optimize query string by removing unnecessary whitespace
   */
  optimizeQueryString(queryString) {
    return queryString
      .replace(/\s+/g, ' ')           // Collapse whitespace
      .replace(/\s*{\s*/g, '{')       // Remove spaces around braces
      .replace(/\s*}\s*/g, '}')
      .replace(/\s*:\s*/g, ':')       // Remove spaces around colons
      .replace(/\s*,\s*/g, ',')       // Remove spaces around commas
      .trim();
  }

  /**
   * Get query statistics
   */
  getQueryStatistics(queryString) {
    try {
      const document = parse(queryString);

      return {
        queryString: {
          originalSize: queryString.length,
          optimizedSize: this.optimizeQueryString(queryString).length,
          compressionRatio: 1 - (this.optimizeQueryString(queryString).length / queryString.length),
        },
        definitions: document.definitions.length,
        queries: document.definitions.filter(d => d.operation === 'query').length,
        mutations: document.definitions.filter(d => d.operation === 'mutation').length,
        fragments: document.definitions.filter(d => d.kind === 'FragmentDefinition').length,
      };
    } catch (error) {
      logger.error('Failed to get query statistics', { error: error.message });
      return null;
    }
  }

  /**
   * Compare two queries
   */
  compareQueries(query1String, query2String) {
    const analysis1 = this.analyzeQuery(query1String);
    const analysis2 = this.analyzeQuery(query2String);

    return {
      query1: analysis1,
      query2: analysis2,
      diff: {
        complexityDifference: analysis2.complexity - analysis1.complexity,
        depthDifference: analysis2.maxDepth - analysis1.maxDepth,
        fieldCountDifference: analysis2.fieldCount - analysis1.fieldCount,
        costDifference: analysis2.estimatedCost - analysis1.estimatedCost,
      },
      isMoreEfficient: analysis2.complexity < analysis1.complexity &&
                       analysis2.fieldCount < analysis1.fieldCount,
    };
  }

  /**
   * Detect query patterns
   */
  detectPatterns(queryString) {
    const patterns = {
      hasAliases: /\w+\s*:\s*\w+/.test(queryString),
      hasFragments: /fragment\s+\w+\s+on/.test(queryString),
      hasVariables: /\$\w+/.test(queryString),
      hasDirectives: /@\w+/.test(queryString),
      hasPagination: /(first|last|skip|limit|offset)/.test(queryString),
      hasFiltering: /(where|filter)/.test(queryString),
      hasSorting: /(orderBy|sort)/.test(queryString),
    };

    return patterns;
  }

  /**
   * Suggest query optimizations
   */
  suggestOptimizations(queryString) {
    const suggestions = [];
    const patterns = this.detectPatterns(queryString);

    if (!patterns.hasFragments && queryString.length > 500) {
      suggestions.push({
        type: 'fragment-extraction',
        message: 'Consider extracting repeated fields into fragments',
        priority: 'medium',
      });
    }

    if (!patterns.hasVariables && queryString.includes('$')) {
      suggestions.push({
        type: 'use-variables',
        message: 'Use variables for dynamic values instead of string interpolation',
        priority: 'high',
      });
    }

    if (!patterns.hasPagination && queryString.includes('[') && queryString.length > 1000) {
      suggestions.push({
        type: 'add-pagination',
        message: 'Add pagination to list queries to reduce payload size',
        priority: 'high',
      });
    }

    const optimized = this.optimizeQueryString(queryString);
    const compressionRatio = 1 - (optimized.length / queryString.length);
    if (compressionRatio > 0.2) {
      suggestions.push({
        type: 'whitespace-optimization',
        message: `Remove unnecessary whitespace to save ${Math.round(compressionRatio * 100)}%`,
        priority: 'low',
        savings: optimized.length,
      });
    }

    return suggestions;
  }
}

export default QueryAnalyzer;
