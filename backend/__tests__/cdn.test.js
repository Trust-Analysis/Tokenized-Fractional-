import { resolveCdnAssetUrl, withCdnAssetUrls } from '../cdn.js';

describe('CDN asset URL helpers', () => {
  const originalCdnUrl = process.env.CDN_URL;
  const originalAssetCdnUrl = process.env.ASSET_CDN_URL;

  afterEach(() => {
    if (originalCdnUrl === undefined) delete process.env.CDN_URL;
    else process.env.CDN_URL = originalCdnUrl;

    if (originalAssetCdnUrl === undefined) delete process.env.ASSET_CDN_URL;
    else process.env.ASSET_CDN_URL = originalAssetCdnUrl;
  });

  test('prefixes relative uploaded asset paths with the CDN base URL', () => {
    expect(resolveCdnAssetUrl('/uploads/asset.jpg', 'https://cdn.example.com')).toBe(
      'https://cdn.example.com/uploads/asset.jpg',
    );
    expect(resolveCdnAssetUrl('documents/deed.pdf', 'https://cdn.example.com/assets')).toBe(
      'https://cdn.example.com/assets/documents/deed.pdf',
    );
  });

  test('preserves absolute and protocol URLs', () => {
    expect(resolveCdnAssetUrl('https://example.com/asset.jpg', 'https://cdn.example.com')).toBe(
      'https://example.com/asset.jpg',
    );
    expect(resolveCdnAssetUrl('ipfs://asset-hash', 'https://cdn.example.com')).toBe(
      'ipfs://asset-hash',
    );
    expect(resolveCdnAssetUrl('data:image/png;base64,abc', 'https://cdn.example.com')).toBe(
      'data:image/png;base64,abc',
    );
  });

  test('rewrites image and document URLs without mutating stored metadata objects', () => {
    process.env.ASSET_CDN_URL = 'https://assets.example.com';
    const asset = {
      imageUrl: '/uploads/home.jpg',
      documents: [
        '/uploads/title.pdf',
        { url: 'docs/report.pdf', label: 'Report' },
        { url: 'https://example.com/external.pdf', label: 'External' },
      ],
    };

    const result = withCdnAssetUrls(asset);

    expect(result).toEqual({
      imageUrl: 'https://assets.example.com/uploads/home.jpg',
      documents: [
        'https://assets.example.com/uploads/title.pdf',
        { url: 'https://assets.example.com/docs/report.pdf', label: 'Report' },
        { url: 'https://example.com/external.pdf', label: 'External' },
      ],
    });
    expect(asset.imageUrl).toBe('/uploads/home.jpg');
    expect(asset.documents[1].url).toBe('docs/report.pdf');
  });
});
