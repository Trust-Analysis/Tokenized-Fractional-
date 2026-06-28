import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sri } from 'vite-plugin-sri3';

export default defineConfig({
  plugins: [react(), sri()],
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
  build: {
    sourcemap: true,
  },
  define: {
    'process.env': {},
  },
});
