import React, { useRef, useState, useCallback, useEffect } from 'react';
import styles from './VirtualTour.module.css';

/**
 * Returns true when the browser can create a WebGL rendering context.
 * Mirrors the detection used by WebGLPriceGraph so the whole app degrades
 * consistently on devices without GPU acceleration.
 */
function detectWebGLSupport() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    return Boolean(gl);
  } catch (err) {
    return false;
  }
}

/**
 * Returns true when the connection is fast enough for a heavy immersive
 * tour. Uses the Network Information API where available and assumes the
 * connection is adequate when the API is not exposed.
 */
function isConnectionFast() {
  if (typeof navigator === 'undefined') return true;
  const connection =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection;
  if (!connection || !connection.effectiveType) return true;
  return !['slow-2g', '2g'].includes(connection.effectiveType);
}

export default function VirtualTour({ imageUrl, title = 'Virtual Tour' }) {
  const containerRef = useRef(null);
  const [rotation, setRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const lastXRef = useRef(0);
  // `null` until detection runs on the client; rendering only the fallback
  // when the full tour is not viable.
  const [tourViable, setTourViable] = useState(null);

  useEffect(() => {
    setTourViable(detectWebGLSupport() && isConnectionFast());
  }, []);

  const handleMouseDown = useCallback((e) => {
    setIsDragging(true);
    lastXRef.current = e.clientX;
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    const delta = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    setRotation((prev) => prev + delta * 0.5);
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      lastXRef.current = e.touches[0].clientX;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!isDragging || e.touches.length !== 1) return;
    const delta = e.touches[0].clientX - lastXRef.current;
    lastXRef.current = e.touches[0].clientX;
    setRotation((prev) => prev + delta * 0.5);
  }, [isDragging]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Graceful fallback for devices without WebGL support or on low-bandwidth
  // connections: a static photo view instead of the interactive panorama.
  if (tourViable === false) {
    return (
      <div
        className={styles.fallback}
        role="img"
        aria-label={`${title} — static preview`}
      >
        <div
          className={styles.fallbackImage}
          style={{ backgroundImage: `url(${imageUrl})` }}
        />
        <div className={styles.fallbackNotice}>
          <span className={styles.controlsHint}>
            360° tour unavailable on this device — showing a static preview
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.container}
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      role="img"
      aria-label={`${title} — drag to look around`}
    >
      <div
        className={styles.panorama}
        style={{
          backgroundImage: `url(${imageUrl})`,
          transform: `translateX(${-rotation}px)`,
        }}
      />
      <div className={styles.overlay}>
        <svg className={styles.controlsIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="8 12 12 16 16 12" />
          <line x1="12" y1="8" x2="12" y2="16" />
        </svg>
        <span className={styles.controlsHint}>Drag to look around 360°</span>
      </div>
    </div>
  );
}
