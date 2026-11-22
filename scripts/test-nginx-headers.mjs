#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https: wss:; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const certDir = mkdtempSync(join(tmpdir(), 'nginx-headers-'));
const httpContainer = `nginx-headers-http-${process.pid}`;
const tlsContainer = `nginx-headers-tls-${process.pid}`;
const upstreams = [3001, 5173].map((port) => createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('ok');
}).listen(port, '127.0.0.1'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} exited with status ${result.status}`);
  }
  return result.stdout?.trim() ?? '';
}

function requestOver(transport, options) {
  return new Promise((resolveRequest, rejectRequest) => {
    const outgoing = transport({
      hostname: '127.0.0.1',
      path: '/api/header-test',
      method: 'GET',
      headers: { Host: 'localhost' },
      agent: false,
      timeout: 5000,
      ...options,
    }, (response) => {
      response.resume();
      response.on('end', () => resolveRequest({ status: response.statusCode, headers: response.headers }));
    });

    outgoing.on('timeout', () => outgoing.destroy(new Error('request timed out')));
    outgoing.on('error', rejectRequest);
    outgoing.end();
  });
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const result = await check();
      if (result.status === 200) {
        return result;
      }
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new Error('Nginx did not become ready with the supplied configuration');
}

function assertCommonHeaders(headers) {
  assert.equal(headers['content-security-policy'], CSP);
  assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.ok(!('x-xss-protection' in headers), 'X-XSS-Protection must not be sent');
}

try {
  run('openssl', [
    'req', '-x509', '-nodes', '-newkey', 'rsa:2048',
    '-keyout', join(certDir, 'privkey.pem'),
    '-out', join(certDir, 'fullchain.pem'),
    '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,DNS:example.com,IP:127.0.0.1',
  ], { stdio: 'ignore' });

  run('docker', [
    'run', '--detach', '--network', 'host', '--name', httpContainer,
    '--volume', `${join(REPO_ROOT, 'nginx', 'nginx.conf')}:/etc/nginx/nginx.conf:ro`,
    'nginx:1.27-alpine',
  ]);

  const httpResponse = await waitFor(() => requestOver(httpRequest, { port: 80 }));
  assertCommonHeaders(httpResponse.headers);
  console.log('nginx.conf header check passed.');

  run('docker', ['rm', '--force', httpContainer], { stdio: 'ignore' });

  run('docker', [
    'run', '--detach', '--network', 'host', '--name', tlsContainer,
    '--volume', `${join(REPO_ROOT, 'nginx', 'nginx.tls.conf')}:/etc/nginx/nginx.conf:ro`,
    '--volume', `${certDir}:/etc/letsencrypt/live/example.com:ro`,
    'nginx:1.27-alpine',
  ]);

  const tlsResponse = await waitFor(() => requestOver(httpsRequest, {
    port: 443,
    servername: 'localhost',
    rejectUnauthorized: false,
  }));
  assertCommonHeaders(tlsResponse.headers);
  assert.equal(
    tlsResponse.headers['strict-transport-security'],
    'max-age=31536000; includeSubDomains',
  );

  const redirect = await requestOver(httpRequest, { port: 80 });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, 'https://localhost/api/header-test');
  assertCommonHeaders(redirect.headers);
  console.log('nginx.tls.conf header and redirect checks passed.');
} finally {
  spawnSync('docker', ['rm', '--force', httpContainer], { stdio: 'ignore' });
  spawnSync('docker', ['rm', '--force', tlsContainer], { stdio: 'ignore' });
  await Promise.all(upstreams.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
  rmSync(certDir, { recursive: true, force: true });
}
