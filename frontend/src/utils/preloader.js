/**
 * Intelligent Resource Preloading Utility
 * Handles dynamic <link rel="preload"> and <link rel="prefetch"> injection,
 * data-saver / network condition checks, and Intersection Observer prefetching.
 */

export const Preloader = {
  /**
   * Check if user has data saver enabled or slow network connection
   */
  shouldRestrainNetwork() {
    if (typeof navigator === 'undefined') return false;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false;

    // Respect Data Saver preference
    if (conn.saveData) return true;

    // Restrain on slow connections (2g, slow-2g)
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') {
      return true;
    }

    return false;
  },

  /**
   * Preload critical above-the-fold resources (rel="preload")
   */
  preloadResource(href, asType, type = '') {
    if (this.shouldRestrainNetwork()) return;
    if (typeof document === 'undefined') return;

    const existing = document.querySelector(`link[href="${href}"]`);
    if (existing) return;

    const link = document.createElement('link');
    link.rel = 'preload';
    link.href = href;
    link.as = asType;
    if (type) link.type = type;

    document.head.appendChild(link);
  },

  /**
   * Prefetch likely next routes or assets (rel="prefetch")
   */
  prefetchRoute(href) {
    if (this.shouldRestrainNetwork()) return;
    if (typeof document === 'undefined') return;

    const existing = document.querySelector(`link[href="${href}"][rel="prefetch"]`);
    if (existing) return;

    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;

    document.head.appendChild(link);
  },

  /**
   * Intersection Observer helper for viewport-based preloading
   */
  observeElementForPrefetch(element, callback, options = { rootMargin: '200px' }) {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      if (callback) callback();
      return null;
    }

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          if (callback) callback(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, options);

    if (element) observer.observe(element);
    return observer;
  }
};
