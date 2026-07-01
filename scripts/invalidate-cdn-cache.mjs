#!/usr/bin/env node
// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

const provider = (process.env.CDN_PROVIDER || 'cloudflare').toLowerCase();

function readInvalidationUrls() {
  const raw = process.env.CDN_INVALIDATION_URLS;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return raw.split(',').map((url) => url.trim()).filter(Boolean);
  }
}

async function purgeCloudflare() {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!zoneId || !apiToken) {
    throw new Error('CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN are required.');
  }

  const files = readInvalidationUrls();
  const body = files.length > 0 ? { files } : { purge_everything: true };
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(`Cloudflare purge failed: ${JSON.stringify(result.errors || result)}`);
  }

  console.log(files.length > 0
    ? `Purged ${files.length} Cloudflare URL(s).`
    : 'Purged the full Cloudflare zone cache.');
}

async function main() {
  if (provider !== 'cloudflare') {
    throw new Error(`Unsupported CDN_PROVIDER "${provider}". Supported provider: cloudflare.`);
  }

  await purgeCloudflare();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
