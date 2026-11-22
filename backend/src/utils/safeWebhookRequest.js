// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

const REQUEST_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;

function isPublicAddress(address) {
  try {
    return ipaddr.parse(address).range() === 'unicast';
  } catch {
    return false;
  }
}

export function parseWebhookUrl(rawUrl) {
  if (typeof rawUrl !== 'string') throw new Error('Webhook URL must be a string');

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Webhook URL must be a valid absolute URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Webhook URL scheme must be HTTP or HTTPS');
  }
  if (url.username || url.password || !url.hostname) {
    throw new Error('Webhook URL must not contain credentials and must include a hostname');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Webhook URL hostname is not publicly routable');
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) {
    throw new Error('Webhook URL hostname is not publicly routable');
  }

  return { url, hostname };
}

export async function resolveWebhookTarget(rawUrl, resolveAddresses = dnsLookup) {
  const { url, hostname } = parseWebhookUrl(rawUrl);
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolveAddresses(hostname, { all: true, verbatim: true });

  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Webhook URL resolves to a non-public IP address');
  }

  return { url, address: addresses[0].address, family: addresses[0].family };
}

export async function postWebhook(rawUrl, { headers, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('Webhook request timed out')),
    timeoutMs,
  );

  try {
    const target = await Promise.race([
      resolveWebhookTarget(rawUrl),
      new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
          once: true,
        });
      }),
    ]);

    return await new Promise((resolve, reject) => {
      const transport = target.url.protocol === 'https:' ? https : http;
      const request = transport.request(
        target.url,
        {
          method: 'POST',
          headers,
          signal: controller.signal,
          lookup: (_hostname, options, callback) => {
            if (options?.all) {
              callback(null, [{ address: target.address, family: target.family }]);
            } else {
              callback(null, target.address, target.family);
            }
          },
        },
        (response) => {
          const chunks = [];
          let size = 0;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              request.destroy(new Error('Webhook response exceeded the size limit'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () => {
            const status = response.statusCode || 0;
            resolve({
              status,
              ok: status >= 200 && status < 300,
              text: async () => Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );

      request.on('error', reject);
      request.end(body);
    });
  } finally {
    clearTimeout(timeout);
  }
}
