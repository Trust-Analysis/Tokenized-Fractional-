import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Issue #718: make RTL cleanup deterministic even for suites that import
// `describe`/`it` explicitly instead of relying on Vitest globals.
afterEach(() => {
  cleanup();
});

// jsdom ships without a handful of browser APIs that the app's components
// touch on mount. Installing inert stubs once here keeps every unit test free
// of per-file polyfills.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}

      unobserve() {}

      disconnect() {}
    };
  }

  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class IntersectionObserver {
      observe() {}

      unobserve() {}

      disconnect() {}

      takeRecords() {
        return [];
      }
    };
  }

  if (!window.scrollTo) {
    window.scrollTo = () => {};
  }
}
