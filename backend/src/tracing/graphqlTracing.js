// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * GraphQL Resolver Tracing
 */

import { trace, context } from '@opentelemetry/api';

const tracer = trace.getTracer('graphql-tracing');

export function createResolverTracing(fieldName) {
  return async (resolve, parent, args, ctx, info) => {
    const span = tracer.startSpan(`graphql.resolve.${fieldName}`, {
      attributes: {
        'graphql.field_name': fieldName,
        'graphql.parent_type': info.parentType.name,
        'graphql.arg_count': Object.keys(args || {}).length,
      },
    });

    const start = Date.now();

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        () => resolve(parent, args, ctx, info)
      );

      span.setAttribute('graphql.resolve_duration_ms', Date.now() - start);
      return result;
    } catch (error) {
      span.recordException(error);
      span.setAttribute('graphql.resolve_duration_ms', Date.now() - start);
      span.setStatus({ code: 2 });
      throw error;
    } finally {
      span.end();
    }
  };
}
