// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * OptimizedImage — Advanced image optimization component.
 *
 * Issue #305: Advanced Image Optimization and Delivery
 *
 * Features:
 *   - Native lazy loading (loading="lazy") for below-the-fold images
 *   - Blur-up / dominant-color placeholder while loading
 *   - Responsive srcset + sizes for adaptive resolution
 *   - <picture> element with WebP/AVIF source fallbacks
 *   - Progressive loading with fade-in transition
 *   - Built-in error fallback with placeholder
 *   - Accessibility (alt text, aria-label)
 */

import React, { useState, useRef, useEffect, memo } from 'react';
import styles from './OptimizedImage.module.css';

/**
 * Generate a tiny blur placeholder data URI (solid color).
 * @param {string} color - CSS color string
 * @returns {string} SVG data URI
 */
function makeBlurPlaceholder(color = '#1a1a2e') {
  // 10×10 pixel placeholder upscaled via CSS (per Issue #375)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="${encodeURIComponent(color)}"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Derive srcset from a base image URL by appending width params.
 * Works with most CDN/ image services that support ?w= syntax.
 * Falls back to the original URL if no transform is detected.
 *
 * @param {string} src     - Base image URL
 * @param {number[]} widths - Array of widths for srcset
 * @returns {string} srcset string
 */
function buildSrcset(src, widths = [320, 640, 960, 1280]) {
  if (!src || src.startsWith('data:')) return '';
  // If the URL already has query params, append; otherwise add ?
  const sep = src.includes('?') ? '&' : '?';
  return widths
    .map((w) => `${src}${sep}w=${w} ${w}w`)
    .join(', ');
}

function OptimizedImage({
  src,
  alt = '',
  width,
  height,
  className = '',
  imgClassName = '',
  loading = 'lazy',
  sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw',
  showWebp = true,
  showAvif = true,
  placeholderColor = '#1a1a2e',
  eager = false,
  ratio, // e.g. '4/3' for aspect-ratio
  ...rest
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [inView, setInView] = useState(eager);
  const imgRef = useRef(null);
  const wrapperRef = useRef(null);

  // Intersection observer to defer loading until near viewport
  useEffect(() => {
    if (eager || inView) return;
    const node = wrapperRef.current;
    if (!node || !('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, inView]);

  const blurPlaceholder = makeBlurPlaceholder(placeholderColor);
  const srcset = buildSrcset(src);
  const baseName = src ? src.replace(/\.[^.]+$/, '') : '';

  const handleLoad = () => setLoaded(true);
  const handleError = () => { setError(true); setLoaded(true); };

  const wrapperStyle = {
    ...(width ? { width: typeof width === 'number' ? `${width}px` : width } : undefined),
    ...(height ? { height: typeof height === 'number' ? `${height}px` : height } : undefined),
    ...(width ? { width: (typeof width === 'number' ? `${width}px` : width) } : undefined),
    ...(height ? { height: (typeof height === 'number' ? `${height}px` : height) } : undefined),
    ...(ratio ? { aspectRatio: ratio } : undefined),
  };

  return (
    <div
      ref={wrapperRef}
      className={`${styles.wrapper} ${className}`}
      style={wrapperStyle}
    >
      {/* Blur placeholder */}
      {!loaded && !error && (
        <img
          src={blurPlaceholder}
          alt=""
          aria-hidden="true"
          className={styles.placeholder}
        />
      )}

      {/* Error fallback */}
      {error ? (
        <div className={styles.errorFallback} role="img" aria-label={alt || 'Image unavailable'}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      ) : inView ? (
        <picture>
          {/* AVIF source (smallest, best compression) */}
          {showAvif && baseName && (
            <source
              type="image/avif"
              srcSet={`${baseName}.avif 1x`}
              sizes={sizes}
            />
          )}
          {/* WebP source (good compression, wide support) */}
          {showWebp && baseName && (
            <source
              type="image/webp"
              srcSet={srcset ? srcset.replace(/\s\d+w/g, (m) => m.replace(/(\d+)w$/, '$1w').replace(/\.(\w+)\?w=/, '.webp?w=')) : `${baseName}.webp`}
              sizes={sizes}
            />
          )}
          {/* Original fallback */}
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            loading={loading}
            decoding="async"
            srcSet={srcset || undefined}
            sizes={sizes}
            onLoad={handleLoad}
            onError={handleError}
            className={`${styles.image} ${loaded ? styles.loaded : ''} ${imgClassName}`}
            {...rest}
          />
        </picture>
      ) : null}

      {/* Loading shimmer */}
      {!loaded && !error && (
        <div className={styles.shimmer} aria-hidden="true" />
      )}
    </div>
  );
}

export default memo(OptimizedImage);
