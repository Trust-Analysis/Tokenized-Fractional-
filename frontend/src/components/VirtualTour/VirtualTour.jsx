import React, { useRef, useState, useCallback } from 'react';
import styles from './VirtualTour.module.css';

export default function VirtualTour({ imageUrl, title = 'Virtual Tour' }) {
  const containerRef = useRef(null);
  const [rotation, setRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const lastXRef = useRef(0);

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
