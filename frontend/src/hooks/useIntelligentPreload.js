import { useEffect } from 'react';
import { Preloader } from '../utils/preloader';

/**
 * useIntelligentPreload Hook
 * Automatically prefetches predictable routes and preloads critical assets 
 * on mount while honoring user data-saver preferences.
 */
export function useIntelligentPreload(routesToPrefetch = [], criticalAssets = []) {
  useEffect(() => {
    if (Preloader.shouldRestrainNetwork()) return;

    // Prefetch predicted next routes
    routesToPrefetch.forEach(route => {
      Preloader.prefetchRoute(route);
    });

    // Preload critical above-the-fold assets
    criticalAssets.forEach(asset => {
      Preloader.preloadResource(asset.href, asset.as, asset.type || '');
    });
  }, [routesToPrefetch, criticalAssets]);
}
