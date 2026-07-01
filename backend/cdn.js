// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

function normalizeBaseUrl(value) {
  if (!value) return '';

  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function isExternalUrl(value) {
  return /^[a-z][a-z\d+\-.]*:/i.test(value) || value.startsWith('//');
}

export function getAssetCdnUrl() {
  return normalizeBaseUrl(process.env.ASSET_CDN_URL || process.env.CDN_URL);
}

export function resolveCdnAssetUrl(value, cdnBaseUrl = getAssetCdnUrl()) {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed || !cdnBaseUrl || isExternalUrl(trimmed)) return value;

  const path = trimmed.replace(/^\/+/, '');
  return new URL(path, `${cdnBaseUrl}/`).toString();
}

export function withCdnAssetUrls(asset) {
  if (!asset || typeof asset !== 'object') return asset;

  const cdnBaseUrl = getAssetCdnUrl();
  if (!cdnBaseUrl) return asset;

  const next = { ...asset };
  next.imageUrl = resolveCdnAssetUrl(next.imageUrl, cdnBaseUrl);

  if (Array.isArray(next.documents)) {
    next.documents = next.documents.map((document) => {
      if (typeof document === 'string') {
        return resolveCdnAssetUrl(document, cdnBaseUrl);
      }

      if (!document || typeof document !== 'object') {
        return document;
      }

      const resolved = { ...document };
      ['url', 'href', 'fileUrl'].forEach((field) => {
        if (field in resolved) {
          resolved[field] = resolveCdnAssetUrl(resolved[field], cdnBaseUrl);
        }
      });
      return resolved;
    });
  }

  return next;
}
