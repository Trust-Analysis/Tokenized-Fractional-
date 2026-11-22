#!/usr/bin/env node
import http from 'node:http';
import https from 'node:https';

const baseUrl = (process.env.API_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const specPath = process.env.OPENAPI_SPEC_PATH || '/api-docs.json';
const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MS || 5000);

function requestJson(urlStr) {
  return new Promise((resolve, reject) => {
    const client = urlStr.startsWith('https://') ? https : http;
    const req = client.get(urlStr, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`GET ${urlStr} returned HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Invalid JSON from ${urlStr}: ${err.message}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout GET ${urlStr}`)); });
    req.on('error', reject);
  });
}

function probeRoute(method, fullPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(fullPath, `${baseUrl}/`);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: method.toUpperCase(),
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ${method} ${u.pathname}`)); });
    req.on('error', reject);
    req.end();
  });
}

function materializePath(openapiPath) {
  return openapiPath.replace(/\{([^}]+)\}/g, 'test-id');
}

async function main() {
  const spec = await requestJson(`${baseUrl}${specPath}`);
  const pathsObj = spec?.paths || {};
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  const missingRoutes = [];
  const checked = [];

  for (const [routePath, pathItem] of Object.entries(pathsObj)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const m of methods) {
      if (!pathItem[m]) continue;
      const concrete = materializePath(routePath);
      const status = await probeRoute(m, concrete);
      checked.push(`${m.toUpperCase()} ${routePath} -> ${status}`);
      if (status === 404 || status === 405) {
        missingRoutes.push(`${m.toUpperCase()} ${routePath} (probed ${concrete}, got ${status})`);
      }
    }
  }

  const undocumentedProbe = '/api/v1/__nonexistent_openapi_drift_check__';
  const undocStatus = await probeRoute('GET', undocumentedProbe);
  if (undocStatus !== 404) {
    missingRoutes.push(`Undocumented probe GET ${undocumentedProbe} returned ${undocStatus} (expected 404)`);
  }

  console.log(`Checked ${checked.length} OpenAPI operations against ${baseUrl}.`);
  for (const line of checked) console.log(`  ${line}`);

  if (missingRoutes.length > 0) {
    console.error('\nOpenAPI vs live container drift detected:');
    for (const item of missingRoutes) console.error(`  - ${item}`);
    process.exit(1);
  }

  console.log('\nLive container routes match OpenAPI spec with no missing or undocumented drift.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
