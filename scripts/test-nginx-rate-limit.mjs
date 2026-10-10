import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const containerName = `nginx-rate-limit-test-${process.pid}`;
const certDir = mkdtempSync(join(tmpdir(), 'nginx-rate-limit-'));
const backend = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('ok');
});

function requestStatus() {
  return new Promise((resolveRequest, rejectRequest) => {
    const outgoing = request({
      hostname: '127.0.0.1',
      port: 443,
      path: '/api/rate-limit-test',
      method: 'GET',
      headers: { Host: 'localhost' },
      servername: 'localhost',
      rejectUnauthorized: false,
      agent: false,
      timeout: 5000,
    }, (response) => {
      response.resume();
      response.on('end', () => resolveRequest(response.statusCode));
    });

    outgoing.on('timeout', () => outgoing.destroy(new Error('request timed out')));
    outgoing.on('error', rejectRequest);
    outgoing.end();
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} exited with status ${result.status}`);
  }
  return result.stdout?.trim() ?? '';
}

try {
  run('openssl', [
    'req', '-x509', '-nodes', '-newkey', 'rsa:2048',
    '-keyout', join(certDir, 'nginx.key'),
    '-out', join(certDir, 'nginx.crt'),
    '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ], { stdio: 'ignore' });

  await new Promise((resolveListen, rejectListen) => {
    backend.once('error', rejectListen);
    backend.listen(3001, '127.0.0.1', resolveListen);
  });

  run('docker', [
    'run', '--detach', '--network', 'host', '--name', containerName,
    '--volume', `${resolve('nginx/nginx.conf')}:/etc/nginx/nginx.conf:ro`,
    '--volume', `${certDir}:/etc/ssl/rwa:ro`,
    'nginx:1.27-alpine',
  ]);

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if (await requestStatus() === 200) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  assert.ok(ready, 'Nginx did not become ready with the supplied configuration');

  const statuses = await Promise.all(Array.from({ length: 60 }, () => requestStatus()));
  const limited = statuses.filter((status) => status === 429).length;
  const proxied = statuses.filter((status) => status === 200).length;
  const statusCounts = statuses.reduce((counts, status) => {
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});

  assert.ok(limited > 0, `Expected at least one HTTP 429; observed ${JSON.stringify(statusCounts)}`);
  assert.ok(proxied > 0, `Expected proxied HTTP 200 responses, received ${proxied}`);
  console.log(`Nginx rate-limit check passed: ${proxied} proxied responses, ${limited} HTTP 429 responses.`);
} finally {
  spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' });
  await new Promise((resolveClose) => backend.close(resolveClose));
  rmSync(certDir, { recursive: true, force: true });
}