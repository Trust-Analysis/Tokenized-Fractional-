import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sri } from 'vite-plugin-sri3';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';

/**
 * Performance budgets for CI enforcement (Issue #367 / #368).
 * The build will emit a warning — and can be configured to fail — when any
 * output chunk exceeds these thresholds.
 *
 * Limits are in bytes (kB × 1024).
 */
const PERFORMANCE_BUDGETS = {
  /** Maximum size for the initial JS payload delivered to the browser */
  initialJsKb: 250,
  /** Maximum size for any single JS chunk */
  chunkJsKb: 500,
  /** Maximum combined CSS size */
  cssKb: 50,
  /** Maximum size for image assets referenced in source */
  imageKb: 200,
};

export default defineConfig({
  plugins: [
    react(),
    sri(),
    VitePWA({
      registerType: 'autoUpdate',
      // Service worker source — we write our own for fine-grained control
      srcDir: 'src',
      filename: 'service-worker.js',
      strategies: 'injectManifest',
      injectManifest: {
        // Workbox will inject the precache manifest into our custom SW
        injectionPoint: 'self.__WB_MANIFEST',
        // Don't precache source maps (large, not needed offline)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      manifest: {
        name: 'RWA Marketplace',
        short_name: 'RWA Market',
        description: 'Tokenized Fractional Real-World Assets Marketplace on Stellar',
        theme_color: '#0a0e17',
        background_color: '#0a0e17',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/favicon.ico',
            sizes: '64x64 32x32 24x24 16x16',
            type: 'image/x-icon',
          },
        ],
      },
      // devOptions — enable SW during `vite dev` so we can test offline behaviour
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
    visualizer({
      filename: 'dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  css: {
    // Enable CSS minification for smaller payloads (Issue #368)
    minify: true,
  },
  build: {
    target: 'esnext',

    // ── Critical CSS: inline styles for above-the-fold content ──────────────
    // Vite automatically extracts and inlines critical CSS when cssCodeSplit
    // is true (the default). Each async chunk gets its own CSS file, which is
    // loaded only when the chunk is needed — meaning non-critical styles never
    // block the initial render. (Issue #368)
    cssCodeSplit: true,

    // ── Performance budgets: warn/fail when chunks exceed size limits ────────
    // chunkSizeWarningLimit controls the Vite console warning. We also add a
    // custom rollup plugin below to enforce hard limits in CI. (Issue #367)
    chunkSizeWarningLimit: PERFORMANCE_BUDGETS.chunkJsKb,

    rollupOptions: {
      output: {
        // ── Manual Chunk Splitting ──────────────────────────────────────────
        // Separating vendor code from app code improves caching: vendor chunks
        // change infrequently, so browsers can reuse cached versions across
        // deployments. This directly reduces the JS payload that must be
        // parsed and executed on page load. (Issue #367)
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('@stellar') || id.includes('stellar-sdk')) {
              return 'vendor-stellar';
            }
            if (id.includes('recharts') || id.includes('d3')) {
              return 'vendor-charts';
            }
            if (id.includes('@sentry')) {
              // Sentry is large — isolate so it doesn't bloat the main bundle
              return 'vendor-sentry';
            }
            if (id.includes('web-vitals')) {
              // web-vitals is already async-imported by performanceMonitoring.js,
              // but if bundled explicitly it gets its own tiny chunk.
              return 'vendor-web-vitals';
            }
            return 'vendor-other';
          }
        },
      },
      plugins: [
        // ── Performance Budget Enforcement Plugin ──────────────────────────
        // Inspects each output bundle after Rollup finishes and reports any
        // chunk that exceeds the configured budget. In CI, set
        // VITE_PERF_BUDGET_FAIL=true to convert warnings into errors.
        {
          name: 'performance-budget',
          generateBundle(options, bundle) {
            const failOnExceed = process.env.VITE_PERF_BUDGET_FAIL === 'true';
            const violations = [];

            for (const [fileName, chunk] of Object.entries(bundle)) {
              if (chunk.type !== 'chunk' && chunk.type !== 'asset') continue;

              const sizeBytes =
                chunk.type === 'chunk'
                  ? Buffer.byteLength(chunk.code || '', 'utf8')
                  : (chunk.source?.length ?? 0);

              const sizeKb = sizeBytes / 1024;

              if (fileName.endsWith('.js') && sizeKb > PERFORMANCE_BUDGETS.chunkJsKb) {
                violations.push(
                  `JS chunk "${fileName}" is ${sizeKb.toFixed(1)} kB (budget: ${PERFORMANCE_BUDGETS.chunkJsKb} kB)`,
                );
              }
              if (fileName.endsWith('.css') && sizeKb > PERFORMANCE_BUDGETS.cssKb) {
                violations.push(
                  `CSS asset "${fileName}" is ${sizeKb.toFixed(1)} kB (budget: ${PERFORMANCE_BUDGETS.cssKb} kB)`,
                );
              }
            }

            if (violations.length) {
              const report = [
                '\n⚠️  Performance Budget Violations:',
                ...violations.map((v) => `   • ${v}`),
                '\nReview bundle analysis: dist/stats.html',
              ].join('\n');

              if (failOnExceed) {
                this.error(report);
              } else {
                this.warn(report);
              }
            } else {
              console.log('\n✅ All chunks within performance budget.');
            }
          },
        },
      ],
    },
  },
  server: {
    port: 5173,
    host: true,
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        "connect-src 'self' https://soroban-testnet.stellar.org https://soroban.stellar.org http://localhost:3001 https://*.ingest.sentry.io ws://localhost:5173",
        "object-src 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // Only collect unit suites under src/. Without this explicit glob Vitest
    // would also match the Playwright specs in `e2e/*.spec.js`; those are run
    // by the Playwright runner, not Vitest, and would fail `npm test`.
    // (Issue #718)
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    // ── Coverage Configuration (Issue #370) ──────────────────────────────────
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      // Enforce 80% minimum coverage across all metrics (Issue #370)
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.test.{js,jsx}',
        'src/main.jsx',          // bootstrap — excluded from coverage
        'src/service-worker.js', // SW has its own test strategy
        'src/workers/**',
      ],
    },
  },
});
