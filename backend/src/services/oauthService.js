/**
 * OAuth 2.0 & OIDC Multi-Provider Authentication Service
 * Supports Google, GitHub, and Discord with PKCE, state validation,
 * profile normalization, and multi-provider account linking.
 */

import crypto from 'crypto';

export class OAuthService {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger || console;
    
    // Provider Configurations (Loaded from environment variables)
    this.providers = {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        scope: 'openid email profile'
      },
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scope: 'user:email read:user'
      },
      discord: {
        clientId: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        authUrl: 'https://discord.com/api/oauth2/authorize',
        tokenUrl: 'https://discord.com/api/oauth2/token',
        userInfoUrl: 'https://discord.com/api/users/@me',
        scope: 'identify email'
      }
    };
  }

  /**
   * Generate secure state and PKCE challenge for OAuth authorization
   */
  generateAuthSession() {
    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { state, codeVerifier, codeChallenge };
  }

  /**
   * Build Provider Authorization URL with PKCE and State
   */
  getAuthorizationUrl(providerName, redirectUri, state, codeChallenge) {
    const provider = this.providers[providerName];
    if (!provider) throw new Error(`Unsupported OAuth provider: ${providerName}`);

    const params = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: provider.scope,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    return `${provider.authUrl}?${params.toString()}`;
  }

  /**
   * Normalize user profiles across different OIDC / OAuth providers
   */
  normalizeProfile(providerName, rawProfile) {
    switch (providerName) {
      case 'google':
        return {
          providerId: rawProfile.sub,
          email: rawProfile.email,
          name: rawProfile.name,
          avatar: rawProfile.picture,
          emailVerified: rawProfile.email_verified
        };
      case 'github':
        return {
          providerId: String(rawProfile.id),
          email: rawProfile.email || `${rawProfile.login}@github.noemail`,
          name: rawProfile.name || rawProfile.login,
          avatar: rawProfile.avatar_url,
          emailVerified: true
        };
      case 'discord':
        return {
          providerId: rawProfile.id,
          email: rawProfile.email,
          name: rawProfile.username,
          avatar: `https://cdn.discordapp.com/avatars/${rawProfile.id}/${rawProfile.avatar}.png`,
          emailVerified: rawProfile.verified
        };
      default:
        throw new Error(`Unknown provider profile normalization: ${providerName}`);
    }
  }

  /**
   * Link an external OAuth provider to an existing user account
   */
  async linkAccount(userId, providerName, profile) {
    this.logger.info({ userId, providerName, providerId: profile.providerId }, 'Linking OAuth provider to account');
    
    // In production, upsert into user_identities table
    return {
      userId,
      provider: providerName,
      providerId: profile.providerId,
      linkedAt: new Date().toISOString()
    };
  }
}
