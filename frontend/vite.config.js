import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sri } from 'vite-plugin-sri3';

export default defineConfig({
  plugins: [react(), sri()],
  server: {
    port: 5173,
  },
  build: {
    sourcemap: true,
  },
  define: {
    'process.env': {},
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  },
});
