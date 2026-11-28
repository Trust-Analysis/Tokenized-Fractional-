// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * usePerformance — React hook for custom, application-specific performance tracking
 *
 * Provides a clean API for components to:
 *  - Track operation durations (wallet connection, asset loading, share purchase)
 *  - Defer non-critical work via requestIdleCallback (Issue #367)
 *  - Schedule animation-frame-aligned updates via requestAnimationFrame
 *  - Report custom metrics to the central performance monitoring pipeline
 *
 * @module usePerformance
 */

import { useCallback, useRef, useEffect } from 'react';
import { reportMetric, measurePerformance } from '../services/performanceMonitoring';

/**
 * Hook that exposes performance-tracking utilities scoped to a component.
 *
 * @param {string} componentName - Name of the using component, used in metric labels
 * @returns {Object} Performance utilities
 */
export function usePerformance(componentName = 'unknown') {
  // Track active idle-callback handles so we can cancel them on unmount
  const idleHandles = useRef(new Set());
  // Track active RAF handles
  const rafHandles = useRef(new Set());
  // Track mount time for time-to-interactive measurements
  const mountTime = useRef(performance.now());

  // Clean up on unmount
  useEffect(() => {
    const idle = idleHandles.current;
    const raf = rafHandles.current;
    return () => {
      if (typeof cancelIdleCallback !== 'undefined') {
        idle.forEach((id) => cancelIdleCallback(id));
      }
      raf.forEach((id) => cancelAnimationFrame(id));
    };
  }, []);

  /**
   * Measures the execution time of an async or sync operation and reports it.
   *
   * @param {string} operationName - Human-readable name (e.g. 'wallet-connect')
   * @param {Function} fn - Async or sync function to measure
   * @returns {Promise<*>} Resolves with fn's return value
   *
   * @example
   * const result = await trackOperation('fetch-assets', () => fetchAssets());
   */
  const trackOperation = useCallback(
    (operationName, fn) => {
      const label = `${componentName}:${operationName}`;
      return measurePerformance(label, fn);
    },
    [componentName],
  );

  /**
   * Manually records the start of a timed operation.
   * Pair with `endTiming` to record a duration.
   *
   * @param {string} operationName - Operation identifier
   * @returns {number} Start timestamp (performance.now())
   */
  const startTiming = useCallback((operationName) => {
    const mark = `${componentName}:${operationName}:start`;
    performance.mark(mark);
    return performance.now();
  }, [componentName]);

  /**
   * Ends a timed operation started with `startTiming` and reports the metric.
   *
   * @param {string} operationName - Must match the label passed to `startTiming`
   * @param {number} startTimestamp - Value returned by `startTiming`
   */
  const endTiming = useCallback(
    (operationName, startTimestamp) => {
      const duration = performance.now() - startTimestamp;
      reportMetric(
        {
          name: 'APP_METRIC',
          value: Math.round(duration),
          id: `${componentName}-${operationName}-${startTimestamp}`,
          label: `${componentName}:${operationName}`,
        },
        'custom',
      );
    },
    [componentName],
  );

  /**
   * Schedules a non-critical function using requestIdleCallback.
   * Falls back to setTimeout(fn, 0) in browsers that don't support rIC.
   * This prevents non-critical work from blocking user interactions (Issue #367).
   *
   * @param {Function} fn - Function to run when the browser is idle
   * @param {number} [timeout=2000] - Max wait time before forced execution (ms)
   * @returns {number} Handle that can be used to cancel
   */
  const scheduleIdleTask = useCallback((fn, timeout = 2000) => {
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(
        (deadline) => {
          idleHandles.current.delete(id);
          fn(deadline);
        },
        { timeout },
      );
      idleHandles.current.add(id);
      return id;
    }
    // Fallback for Safari / environments without rIC
    const id = setTimeout(() => {
      idleHandles.current.delete(id);
      fn({ timeRemaining: () => 0, didTimeout: true });
    }, 0);
    idleHandles.current.add(id);
    return id;
  }, []);

  /**
   * Schedules a function to run on the next animation frame using rAF.
   * Use this for any DOM mutations or style changes to keep animations smooth
   * and avoid layout thrashing (Issue #367).
   *
   * @param {Function} fn - Function to run on next frame
   * @returns {number} Animation frame handle
   */
  const scheduleFrame = useCallback((fn) => {
    const id = requestAnimationFrame((timestamp) => {
      rafHandles.current.delete(id);
      fn(timestamp);
    });
    rafHandles.current.add(id);
    return id;
  }, []);

  /**
   * Reports the component's Time-to-Interactive (TTI) relative to mount.
   * Call this once the component has finished loading its data and is
   * ready for user interaction.
   *
   * @param {string} [label='ready'] - Sub-label for differentiation
   */
  const reportTimeToInteractive = useCallback(
    (label = 'ready') => {
      const tti = Math.round(performance.now() - mountTime.current);
      reportMetric(
        {
          name: 'APP_METRIC',
          value: tti,
          id: `${componentName}-tti-${Date.now()}`,
          label: `${componentName}:tti:${label}`,
        },
        'custom-tti',
      );
    },
    [componentName],
  );

  /**
   * Breaks a large array-processing task into smaller async chunks that
   * yield to the main thread between chunks, preventing long tasks (Issue #367).
   *
   * @param {Array} items - Items to process
   * @param {Function} processor - Function called with each item
   * @param {number} [chunkSize=50] - Items per chunk
   * @returns {Promise<void>}
   */
  const processInChunks = useCallback(async (items, processor, chunkSize = 50) => {
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      chunk.forEach(processor);
      // Yield to the main thread after each chunk
      if (i + chunkSize < items.length) {
        await new Promise((resolve) => scheduleFrame(resolve));
      }
    }
  }, [scheduleFrame]);

  return {
    trackOperation,
    startTiming,
    endTiming,
    scheduleIdleTask,
    scheduleFrame,
    reportTimeToInteractive,
    processInChunks,
  };
}

export default usePerformance;
