// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * OpenTelemetry Distributed Tracing Configuration
 * 
 * Initializes OpenTelemetry tracing with span processors, exporters, and instrumentations
 * for Express, GraphQL, database queries, and HTTP calls (including Soroban RPC).
 * 
 * See: https://opentelemetry.io/docs/
 */

import { NodeTracerProvider } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace, context, metrics } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger-basic';
import { ResourceDetectionConfig, detectResources } from '@opentelemetry/resources';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis-4';

/**
 * Initialize OpenTelemetry tracing
 * 
 * Supports multiple exporters:
 * - OTLP HTTP: Standard protocol, works with most backends (Jaeger, Grafana Loki, etc.)
 * - Jaeger: Direct Jaeger exporter for maximum compatibility
 * 
 * Environment variables:
 * - OTEL_ENABLED: Enable/disable tracing (default: true if OTEL_EXPORTER_OTLP_ENDPOINT set)
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP collector endpoint (e.g., http://localhost:4318)
 * - OTEL_JAEGER_AGENT_HOST: Jaeger agent host (e.g., localhost)
 * - OTEL_JAEGER_AGENT_PORT: Jaeger agent port (default: 6831)
 * - OTEL_SERVICE_NAME: Service name (default: "rwa-marketplace-backend")
 * - OTEL_TRACES_EXPORTER: Exporter type: "otlp" or "jaeger" (default: "otlp")
 * - OTEL_SAMPLE_RATE: Sampling rate 0.0-1.0 (default: 0.1 = 10%)
 */
export function initializeTracing() {
  const isEnabled = process.env.OTEL_ENABLED !== 'false';
  const hasOtlpEndpoint = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const hasJaegerConfig = process.env.OTEL_JAEGER_AGENT_HOST || process.env.OTEL_JAEGER_AGENT_PORT;
  
  if (!isEnabled || (!hasOtlpEndpoint && !hasJaegerConfig)) {
    console.log('[OTEL] Distributed tracing disabled');
    return null;
  }

  try {
    const serviceName = process.env.OTEL_SERVICE_NAME || 'rwa-marketplace-backend';
    const environment = process.env.NODE_ENV || 'development';
    const sampleRate = parseFloat(process.env.OTEL_SAMPLE_RATE || '0.1');
    
    console.log(`[OTEL] Initializing distributed tracing (service: ${serviceName}, rate: ${sampleRate})`);

    // Create resource with service metadata
    const resource = Resource.default().merge(
      new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '2.0.0',
        environment,
        'deployment.environment': environment,
      })
    );

    // Create tracer provider
    const tracerProvider = new NodeTracerProvider({
      resource,
      sampler: createProbabilitySampler(sampleRate),
    });

    // Configure exporter based on environment variable
    const exporterType = process.env.OTEL_TRACES_EXPORTER || 'otlp';
    
    if (exporterType === 'jaeger') {
      // Jaeger exporter
      const jaegerExporter = new JaegerExporter({
        host: process.env.OTEL_JAEGER_AGENT_HOST || 'localhost',
        port: parseInt(process.env.OTEL_JAEGER_AGENT_PORT || '6831', 10),
        maxPacketSize: 65000,
      });
      tracerProvider.addSpanProcessor(new BatchSpanProcessor(jaegerExporter));
      console.log('[OTEL] Using Jaeger exporter');
    } else {
      // OTLP exporter (default, more flexible)
      const otlpExporter = new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
          ? JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS)
          : {},
        timeoutMillis: 30000,
      });
      tracerProvider.addSpanProcessor(new BatchSpanProcessor(otlpExporter));
      console.log(`[OTEL] Using OTLP exporter (${process.env.OTEL_EXPORTER_OTLP_ENDPOINT})`);
    }

    // Register auto-instrumentations
    registerInstrumentations({
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-http': {
            enabled: true,
            requestHook: (span, request) => {
              span.setAttribute('http.client_ip', getClientIp(request));
            },
            responseHook: (span, response) => {
              span.setAttribute('http.status_code', response.statusCode);
            },
          },
          '@opentelemetry/instrumentation-express': {
            enabled: true,
          },
          '@opentelemetry/instrumentation-pg': {
            enabled: true,
            enhancedDatabaseReporting: true,
          },
          '@opentelemetry/instrumentation-redis-4': {
            enabled: true,
          },
        }),
      ],
      tracerProvider,
    });

    // Set global tracer provider
    trace.setGlobalTracerProvider(tracerProvider);

    // Optional: Initialize metrics
    initializeMetrics(resource, sampleRate);

    console.log('[OTEL] Distributed tracing initialized successfully');
    return tracerProvider;
  } catch (error) {
    console.error('[OTEL] Failed to initialize tracing:', error);
    return null;
  }
}

/**
 * Create a probability sampler
 */
function createProbabilitySampler(probability) {
  return {
    shouldSample: () => ({
      decision: Math.random() < probability ? 2 : 1, // 2=RECORD_AND_SAMPLE, 1=NOT_RECORD
    }),
    toString: () => `ProbabilitySampler(${probability})`,
  };
}

/**
 * Extract client IP from request
 */
function getClientIp(request) {
  return (
    request.headers['x-forwarded-for']?.split(',')[0].trim() ||
    request.headers['x-real-ip'] ||
    request.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Initialize OpenTelemetry Metrics
 */
function initializeMetrics(resource, sampleRate) {
  try {
    if (process.env.OTEL_METRICS_DISABLED === 'true') {
      console.log('[OTEL] Metrics disabled');
      return;
    }

    const exporterType = process.env.OTEL_METRICS_EXPORTER || 'otlp';
    
    if (exporterType === 'otlp') {
      const metricExporter = new OTLPMetricExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
          ? JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS)
          : {},
        timeoutMillis: 30000,
      });

      const metricReader = new PeriodicExportingMetricReader({
        exporter: metricExporter,
        intervalMillis: 60000,
      });

      const meterProvider = new MeterProvider({
        resource,
        readers: [metricReader],
      });

      metrics.setGlobalMeterProvider(meterProvider);
      console.log('[OTEL] Metrics initialized');
    }
  } catch (error) {
    console.error('[OTEL] Failed to initialize metrics:', error);
  }
}

/**
 * Get the global tracer
 */
export function getTracer(name = 'rwa-marketplace') {
  return trace.getTracer(name, process.env.npm_package_version || '2.0.0');
}

/**
 * Get the global meter
 */
export function getMeter(name = 'rwa-marketplace') {
  return metrics.getMeter(name, process.env.npm_package_version || '2.0.0');
}

/**
 * Create a new span
 */
export function createSpan(name, options = {}) {
  const tracer = getTracer();
  return tracer.startSpan(name, options);
}

/**
 * Run a function within a span context
 */
export async function withSpan(name, fn, options = {}) {
  const tracer = getTracer();
  const span = tracer.startSpan(name, options);

  try {
    return await context.with(trace.setSpan(context.active(), span), fn);
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: 2 }); // ERROR
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Add attributes to current span
 */
export function addSpanAttributes(attributes) {
  const span = trace.getActiveSpan();
  if (span) {
    Object.entries(attributes).forEach(([key, value]) => {
      span.setAttribute(key, value);
    });
  }
}

/**
 * Record an event on the current span
 */
export function recordSpanEvent(name, attributes = {}) {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Mark current span as error
 */
export function recordSpanError(error) {
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({ code: 2 }); // ERROR
  }
}

/**
 * Get trace ID of current span (useful for logging correlation)
 */
export function getTraceId() {
  const span = trace.getActiveSpan();
  if (span) {
    const spanContext = span.spanContext();
    return spanContext.traceId;
  }
  return 'unknown';
}

/**
 * Get span ID of current span
 */
export function getSpanId() {
  const span = trace.getActiveSpan();
  if (span) {
    const spanContext = span.spanContext();
    return spanContext.spanId;
  }
  return 'unknown';
}
