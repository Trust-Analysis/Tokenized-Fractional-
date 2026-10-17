export function createRateLimiter(rateLimiterService, options = {}) {
  const {
    extractApiKey = defaultExtractApiKey,
    extractGeo = defaultExtractGeo,
    onBlocked = defaultOnBlocked,
  } = options;

  async function rateLimiterMiddleware(req, res, next) {
    const apiKey = extractApiKey(req);
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const geo = extractGeo(req);

    const effectiveKey = apiKey || `anon:${ip}`;

    if (!apiKey && !rateLimiterService.apiKeyTiers.has(effectiveKey)) {
      rateLimiterService.configureApiKey(effectiveKey, 'free', { anonymous: true });
    }

    const result = await rateLimiterService.checkRateLimit(effectiveKey, {
      ip,
      geo,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method,
    });

    for (const [key, value] of Object.entries(result.headers || {})) {
      res.setHeader(key, value);
    }

    if (!result.allowed) {
      if (result.retryAfter) {
        res.setHeader('Retry-After', String(result.retryAfter));
      }

      if (result.upgradePrompt) {
        res.setHeader('X-RateLimit-Upgrade-Available', String(result.upgradePrompt.upgradeAvailable));
        if (result.upgradePrompt.upgradeAvailable) {
          res.setHeader('X-RateLimit-Upgrade-Tiers', JSON.stringify(result.upgradePrompt.tiers.map(t => t.id)));
          res.setHeader('X-RateLimit-Upgrade-Message', encodeURIComponent(result.upgradePrompt.message));
        }
      }

      return onBlocked(req, res, result);
    }

    next();
  }

  return rateLimiterMiddleware;
}

function defaultExtractApiKey(req) {
  return req.headers['x-api-key'] || req.query.api_key || null;
}

function defaultExtractGeo(req) {
  const country = req.headers['cf-ipcountry']
    || req.headers['x-country-code']
    || req.headers['geo-country']
    || null;
  const city = req.headers['cf-ipcity'] || null;
  const region = req.headers['cf-region'] || null;

  if (!country && !region) return null;

  return { country, city, region };
}

function defaultOnBlocked(req, res, result) {
  const body = { error: 'Rate limit exceeded' };

  if (result.reason) {
    body.reason = result.reason;
  }

  if (result.upgradePrompt) {
    body.upgrade = result.upgradePrompt;
  }

  return res.status(result.status || 429).json(body);
}

export function createRateLimitMiddleware(options = {}) {
  return async function rateLimitedRoute(req, res, next) {
    const maxConcurrent = options.maxConcurrent || 5;
    const activeKey = `__active_${req.ip}`;

    if (!req.app.locals[activeKey]) {
      req.app.locals[activeKey] = 0;
    }
    req.app.locals[activeKey]++;

    if (req.app.locals[activeKey] > maxConcurrent) {
      req.app.locals[activeKey]--;
      return res.status(503).json({ error: 'Server busy, please retry' });
    }

    try {
      await next();
    } finally {
      req.app.locals[activeKey]--;
    }
  };
}
