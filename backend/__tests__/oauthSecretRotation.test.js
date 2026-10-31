/**
 * Issue #899: OAuth client secret rotation
 *
 * Covers the rotation grace period: during a rotation both the new secret
 * (`<PROVIDER>_CLIENT_SECRET`) and the outgoing secret
 * (`<PROVIDER>_CLIENT_SECRET_PREVIOUS`) are accepted, so in-flight
 * authorization flows are not broken by the rotation.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { OAuthService } from '../src/services/oauthService.js';

const ENV_KEYS = [
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET_PREVIOUS',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CLIENT_SECRET_PREVIOUS',
  'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_CLIENT_SECRET_PREVIOUS',
];

describe('Issue #899: OAuth client secret rotation grace period', () => {
  let savedEnv;

  beforeAll(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-new-secret';
    process.env.GOOGLE_CLIENT_SECRET_PREVIOUS = 'google-old-secret';

    process.env.GITHUB_CLIENT_ID = 'github-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'github-new-secret';
    // no previous secret configured for github

    process.env.DISCORD_CLIENT_ID = 'discord-client-id';
    process.env.DISCORD_CLIENT_SECRET = 'discord-new-secret';
    process.env.DISCORD_CLIENT_SECRET_PREVIOUS = 'discord-old-secret';
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  test('during rotation, both current and previous secrets are active (newest first)', () => {
    const service = new OAuthService(null, console);
    const secrets = service.getActiveClientSecrets('google');

    expect(secrets).toHaveLength(2);
    expect(secrets[0]).toEqual({
      value: 'google-new-secret',
      source: 'current',
      envVar: 'GOOGLE_CLIENT_SECRET',
    });
    expect(secrets[1]).toEqual({
      value: 'google-old-secret',
      source: 'previous',
      envVar: 'GOOGLE_CLIENT_SECRET_PREVIOUS',
    });
  });

  test('without a previous secret configured only the current one is active', () => {
    const service = new OAuthService(null, console);
    const secrets = service.getActiveClientSecrets('github');

    expect(secrets).toHaveLength(1);
    expect(secrets[0].source).toBe('current');
    expect(secrets[0].envVar).toBe('GITHUB_CLIENT_SECRET');
  });

  test('matchClientSecret accepts either the new or the outgoing secret', () => {
    const service = new OAuthService(null, console);

    expect(service.matchClientSecret('google', 'google-new-secret')).toBe('current');
    expect(service.matchClientSecret('google', 'google-old-secret')).toBe('previous');

    // The old secret stays valid for in-flight flows during the whole window
    expect(service.matchClientSecret('discord', 'discord-old-secret')).toBe('previous');
  });

  test('matchClientSecret rejects unknown or malformed candidates', () => {
    const service = new OAuthService(null, console);

    expect(service.matchClientSecret('google', 'wrong-secret')).toBeNull();
    expect(service.matchClientSecret('google', '')).toBeNull();
    expect(service.matchClientSecret('google', null)).toBeNull();
    expect(service.matchClientSecret('google', undefined)).toBeNull();
    expect(service.matchClientSecret('google', 12345)).toBeNull();
    // Different length must not throw (timingSafeEqual requires equal length)
    expect(service.matchClientSecret('google', 'google-new-secret-extra')).toBeNull();
  });

  test('providers without any configured secret match nothing', () => {
    delete process.env.GITHUB_CLIENT_SECRET;
    try {
      const service = new OAuthService(null, console);
      expect(service.getActiveClientSecrets('github')).toHaveLength(0);
      expect(service.matchClientSecret('github', 'github-new-secret')).toBeNull();
    } finally {
      process.env.GITHUB_CLIENT_SECRET = 'github-new-secret';
    }
  });

  test('every configured provider reads its own rotation env var pair', () => {
    const service = new OAuthService(null, console);

    for (const [provider, newSecret, oldSecret] of [
      ['google', 'google-new-secret', 'google-old-secret'],
      ['github', 'github-new-secret', null],
      ['discord', 'discord-new-secret', 'discord-old-secret'],
    ]) {
      const secrets = service.getActiveClientSecrets(provider);
      const prefix = provider.toUpperCase();
      expect(secrets[0]).toMatchObject({
        value: newSecret,
        source: 'current',
        envVar: `${prefix}_CLIENT_SECRET`,
      });
      if (oldSecret) {
        expect(secrets[1]).toMatchObject({
          value: oldSecret,
          source: 'previous',
          envVar: `${prefix}_CLIENT_SECRET_PREVIOUS`,
        });
      }
    }
  });

  test('unknown providers are rejected explicitly', () => {
    const service = new OAuthService(null, console);
    expect(() => service.getActiveClientSecrets('twitter')).toThrow('Unsupported OAuth provider: twitter');
    expect(() => service.matchClientSecret('twitter', 'anything')).toThrow('Unsupported OAuth provider: twitter');
  });

  test('primary clientSecret stays backwards-compatible with the existing config shape', () => {
    const service = new OAuthService(null, console);
    expect(service.providers.google.clientSecret).toBe('google-new-secret');
    expect(service.providers.google.previousClientSecret).toBe('google-old-secret');
    expect(service.providers.github.clientSecret).toBe('github-new-secret');
    expect(service.providers.discord.clientSecret).toBe('discord-new-secret');
  });
});
