export class GeoLimiter {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.enabled = process.env.GEO_LIMITING_ENABLED !== 'false';
    this.db = options.db || null;

    this.blockedCountries = new Set(
      (process.env.GEO_BLOCKED_COUNTRIES || '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
    );

    this.restrictedCountries = new Map();
    const restrictedRaw = process.env.GEO_RESTRICTED_COUNTRIES || '';
    if (restrictedRaw) {
      for (const entry of restrictedRaw.split(',')) {
        const [country, limit] = entry.split(':');
        if (country && limit) {
          this.restrictedCountries.set(country.trim().toUpperCase(), parseInt(limit) || 100);
        }
      }
    }

    this.countryRequestCounts = new Map();
    this.tierCountryOverrides = new Map();
    this._cleanupInterval = setInterval(() => this._cleanup(), 300000);
  }

  setTierCountryOverride(tier, country, action) {
    if (!this.tierCountryOverrides.has(tier)) {
      this.tierCountryOverrides.set(tier, new Map());
    }
    this.tierCountryOverrides.get(tier).set(country.toUpperCase(), action);
  }

  async check(ip, geo, apiKey) {
    if (!this.enabled) return { blocked: false };

    const result = { blocked: false, country: geo?.country || 'unknown', reason: null };

    if (!geo?.country) return result;

    const country = geo.country.toUpperCase();

    if (this.blockedCountries.has(country)) {
      result.blocked = true;
      result.reason = 'country_blocked';
      return result;
    }

    const restrictedLimit = this.restrictedCountries.get(country);
    if (restrictedLimit) {
      const now = Date.now();
      const windowMs = 3600000;
      const counts = this.countryRequestCounts.get(country) || [];
      const recent = counts.filter(t => now - t < windowMs);

      if (recent.length >= restrictedLimit) {
        result.blocked = true;
        result.reason = 'country_rate_limited';
        return result;
      }

      recent.push(now);
      this.countryRequestCounts.set(country, recent.slice(-restrictedLimit * 2));
    }

    return result;
  }

  getCountryStats() {
    const stats = {};
    for (const [country, counts] of this.countryRequestCounts) {
      const now = Date.now();
      const recent = counts.filter(t => now - t < 3600000);
      stats[country] = {
        requestsLastHour: recent.length,
        blocked: this.blockedCountries.has(country),
        restricted: this.restrictedCountries.has(country),
        limit: this.restrictedCountries.get(country) || null,
      };
    }
    return stats;
  }

  _cleanup() {
    const now = Date.now();
    for (const [country, counts] of this.countryRequestCounts) {
      const recent = counts.filter(t => now - t < 3600000);
      if (recent.length === 0) {
        this.countryRequestCounts.delete(country);
      } else {
        this.countryRequestCounts.set(country, recent);
      }
    }
  }

  destroy() {
    if (this._cleanupInterval) clearInterval(this._cleanupInterval);
    this.countryRequestCounts.clear();
  }
}
