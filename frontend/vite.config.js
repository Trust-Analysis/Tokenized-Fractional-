import { createHash } from 'node:crypto';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { sri } from 'vite-plugin-sri3';
import { VitePWA } from 'vite-plugin-pwa';

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
  ],
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
});
