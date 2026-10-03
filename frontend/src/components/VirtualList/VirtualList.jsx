// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * VirtualList — Virtual scrolling component for large datasets.
 *
 * Issue #307: Virtual Scrolling for Large Dataset Performance
 *
 * Features:
 *   - Renders only visible items + buffer (windowing)
 *   - Supports fixed-height and variable-height items
 *   - Smooth scrolling with transform-based positioning
 *   - Maintains scroll position on data updates
 *   - Works seamlessly with filtering, sorting, pagination
 *   - Configurable overscan buffer for smooth scrolling
 *   - No external dependency (lightweight implementation)
 *   - Accessible (ARIA rowcount, rowindex)
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import styles from './VirtualList.module.css';

const DEFAULT_ITEM_HEIGHT = 80;
const DEFAULT_OVERSCAN = 5;

function VirtualList({
  items = [],
  itemHeight = DEFAULT_ITEM_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  height = 500,
  renderItem,
  keyExtractor,
  className = '',
  variableHeight = false,
  onScroll,
  ...rest
}) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(height);
  const measuredHeights = useRef({});
  const resizeObserverRef = useRef(null);

  // Measure container height
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateHeight = () => setContainerHeight(node.clientHeight);
    updateHeight();

    // Use ResizeObserver for responsive height tracking
    if ('ResizeObserver' in window) {
      resizeObserverRef.current = new ResizeObserver(updateHeight);
      resizeObserverRef.current.observe(node);
    }

    return () => {
      if (resizeObserverRef.current) resizeObserverRef.current.disconnect();
    };
  }, []);

  // Handle scroll events
  const handleScroll = useCallback((e) => {
    const newScrollTop = e.currentTarget.scrollTop;
    setScrollTop(newScrollTop);
    if (onScroll) onScroll(newScrollTop);
  }, [onScroll]);

  // Calculate visible range
  const { startIndex, endIndex, totalHeight, offsetY, visibleItems } = useMemo(() => {
    const count = items.length;

    // Variable height mode: use measured heights or fall back to estimate
    if (variableHeight) {
      let top = 0;
      let start = 0;
      let end = 0;

      // Find start index
      for (let i = 0; i < count; i++) {
        const h = measuredHeights.current[i] || itemHeight;
        if (top + h > scrollTop - overscan * itemHeight) {
          start = i;
          break;
        }
        top += h;
      }

      // Find end index
      let currentTop = top;
      for (let i = start; i < count; i++) {
        const h = measuredHeights.current[i] || itemHeight;
        currentTop += h;
        if (currentTop > scrollTop + containerHeight + overscan * itemHeight) {
          end = i + 1;
          break;
        }
      }
      end = end || count;

      // Build visible items with positions
      const visible = [];
      let posOffset = 0;
      for (let i = 0; i < count; i++) {
        const h = measuredHeights.current[i] || itemHeight;
        if (i >= start && i < end) {
          visible.push({ index: i, item: items[i], offset: posOffset, height: h });
        }
        posOffset += h;
      }

      return {
        startIndex: start,
        endIndex: end,
        totalHeight: posOffset,
        offsetY: 0,
        visibleItems: visible,
      };
    }

    // Fixed height mode (simpler + faster)
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(count, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan);
    const total = count * itemHeight;

    const visible = [];
    for (let i = start; i < end; i++) {
      visible.push({
        index: i,
        item: items[i],
        offset: i * itemHeight,
        height: itemHeight,
      });
    }

    return {
      startIndex: start,
      endIndex: end,
      totalHeight: total,
      offsetY: start * itemHeight,
      visibleItems: visible,
    };
  }, [items, scrollTop, containerHeight, itemHeight, overscan, variableHeight]);

  // Measure item heights (variable height mode)
  const measureItem = useCallback((index, node) => {
    if (!variableHeight || !node) return;
    const h = node.getBoundingClientRect().height;
    if (measuredHeights.current[index] !== h) {
      measuredHeights.current[index] = h;
    }
  }, [variableHeight]);

  const getKey = useCallback((item, index) => {
    if (keyExtractor) return keyExtractor(item, index);
    return index;
  }, [keyExtractor]);

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${className}`}
      style={{ height: typeof height === 'number' ? `${height}px` : height, overflowY: 'auto' }}
      onScroll={handleScroll}
      role="list"
      aria-rowcount={items.length}
      tabIndex={0}
      {...rest}
    >
      <div className={styles.inner} style={{ height: `${totalHeight}px`, position: 'relative' }}>
        <div
          className={styles.content}
          style={{
            transform: variableHeight ? undefined : `translateY(${offsetY}px)`,
            position: variableHeight ? 'absolute' : 'absolute',
            top: 0,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map(({ index, item, offset, height: h }) => (
            <div
              key={getKey(item, index)}
              ref={(node) => measureItem(index, node)}
              role="listitem"
              aria-rowindex={index + 1}
              style={{
                position: 'absolute',
                top: `${offset}px`,
                left: 0,
                right: 0,
                height: variableHeight ? 'auto' : `${h}px`,
              }}
            >
              {renderItem({ item, index })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default memo(VirtualList);
