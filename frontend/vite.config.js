import { createHash } from 'node:crypto';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { sri } from 'vite-plugin-sri3';

function normalizeCdnBase(value) {
  if (!value) return '/';

  const trimmed = value.trim();
  if (!trimmed) return '/';

  try {
    const url = new URL(trimmed);
    return `${url.toString().replace(/\/+$/, '')}/`;
  } catch {
    return '/';
  }
}

function getCdnOrigin(value) {
  if (!value || value === '/') return '';

  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function cdnCspPlugin(cdnOrigin) {
  return {
    name: 'cdn-csp-origin',
    transformIndexHtml(html) {
      if (!cdnOrigin) return html;

      return html
        .replace("script-src 'self' 'wasm-unsafe-eval';", `script-src 'self' ${cdnOrigin} 'wasm-unsafe-eval';`)
        .replace(
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;",
          `style-src 'self' ${cdnOrigin} 'unsafe-inline' https://fonts.googleapis.com;`
        );
    },
  };
}

function cdnSriPlugin(cdnBase) {
  return {
    name: 'cdn-sri',
    enforce: 'post',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assetTagPattern = /<(script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/g;

      for (const fileName in bundle) {
        const item = bundle[fileName];
        if (item.type !== 'asset' || !/\.(html|htm)$/.test(item.fileName)) continue;

        let html = item.source.toString();
        const changes = [];
        let match;

        while ((match = assetTagPattern.exec(html))) {
          const [tag, , url] = match;
          if (tag.includes(' integrity=') || !url.startsWith(cdnBase)) continue;

          const bundleKey = url.slice(cdnBase.length).split(/[?#]/)[0];
          const referenced = bundle[bundleKey];
          if (!referenced) continue;

          const source = referenced.type === 'chunk' ? referenced.code : referenced.source;
          const integrity = `sha384-${createHash('sha384').update(source).digest('base64')}`;
          const insertAt = match.index + tag.length - (tag.endsWith('/>') ? 2 : 1);
          changes.push({ insertAt, integrity });
        }

        for (let i = changes.length - 1; i >= 0; i--) {
          const { insertAt, integrity } = changes[i];
          html = `${html.slice(0, insertAt)} integrity="${integrity}"${html.slice(insertAt)}`;
        }

        item.source = html;
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const cdnBase = normalizeCdnBase(env.VITE_CDN_URL || env.CDN_URL);
  const cdnOrigin = getCdnOrigin(cdnBase);

  return {
    base: cdnBase,
    plugins: [
      react(),
      cdnCspPlugin(cdnOrigin),
      cdnOrigin ? cdnSriPlugin(cdnBase) : sri(),
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
      exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    },
  };
});
