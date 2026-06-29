import React from 'react';
import Skeleton from './Skeleton';

/**
 * TextSkeleton — convenience wrapper for one or more lines of text skeleton.
 *
 * @param {number} lines  - Number of text lines to render (default 1).
 * @param {string} width  - CSS width override for single-line variant.
 * @param {string} height - CSS height override.
 */
export function TextSkeleton({ lines = 1, width, height, style, className, ...rest }) {
  return (
    <Skeleton
      variant="text"
      lines={lines}
      width={width}
      height={height}
      style={style}
      className={className}
      {...rest}
    />
  );
}

/**
 * ImageSkeleton — convenience wrapper for an image / rect placeholder.
 *
 * @param {string} width  - CSS width (default '100%').
 * @param {string} height - CSS height (default '180px').
 */
export function ImageSkeleton({ width = '100%', height = '180px', style, className, ...rest }) {
  return (
    <Skeleton
      variant="rect"
      width={width}
      height={height}
      style={style}
      className={className}
      {...rest}
    />
  );
}
