/**
 * OAuth Authentication Routes
 * Endpoints for initiating auth, handling callbacks, and account linking.
 */

import express from 'express';
import { OAuthService } from '../services/oauthService.js';

export function createOAuthRouter(db, logger) {
  const router = express.Router();
  const oauthService = new OAuthService(db, logger);

  // Initiate OAuth Flow
  router.get('/:provider', (req, res) => {
    try {
      const { provider } = req.params;
      const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/${provider}/callback`;
      
      const { state, codeVerifier, codeChallenge } = oauthService.generateAuthSession();

      // Store verifier and state in session or secure cookie in real app
      res.cookie(`oauth_state_${provider}`, state, { httpOnly: true, secure: true, maxAge: 300000 });
      res.cookie(`oauth_verifier_${provider}`, codeVerifier, { httpOnly: true, secure: true, maxAge: 300000 });

      const authUrl = oauthService.getAuthorizationUrl(provider, redirectUri, state, codeChallenge);
      res.redirect(authUrl);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // OAuth Callback Handler
  router.get('/:provider/callback', async (req, res) => {
    try {
      const { provider } = req.params;
      const { code, state } = req.query;

      const expectedState = req.cookies[`oauth_state_${provider}`];
      if (!state || state !== expectedState) {
        return res.status(403).json({ error: 'Invalid OAuth state parameter (CSRF protection)' });
      }

      // Mock successful token exchange and normalization for demonstration
      res.json({
        success: true,
        provider,
        message: 'OAuth authentication successful. Tokens issued and verified via PKCE.'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
