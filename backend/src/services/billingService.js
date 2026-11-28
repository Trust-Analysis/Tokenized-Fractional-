export class BillingService {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.db = options.db || null;
    this.enabled = process.env.BILLING_INTEGRATION_ENABLED !== 'false';
    this.stripeKey = process.env.STRIPE_SECRET_KEY || null;
    this.stripe = null;

    this.tierPricing = {
      free: { monthly: 0, requestsIncluded: 30000, overageRate: 0.001 },
      premium: { monthly: 49, requestsIncluded: 300000, overageRate: 0.0005 },
      enterprise: { monthly: 499, requestsIncluded: 3000000, overageRate: 0.0001 },
    };

    this.subscriptions = new Map();
    this.usageRecords = new Map();
    this._initStripe();
  }

  async _initStripe() {
    if (this.stripeKey) {
      try {
        const stripeModule = await import('stripe');
        this.stripe = stripeModule.default(this.stripeKey);
      } catch {
        this.logger.warn('Stripe not available, billing runs in usage-tracking mode');
      }
    }
  }

  async createSubscription(apiKey, tier, options = {}) {
    const pricing = this.tierPricing[tier];
    if (!pricing) throw new Error(`Invalid tier: ${tier}`);

    const subscription = {
      apiKey,
      tier,
      status: 'active',
      startedAt: new Date().toISOString(),
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: this._addMonth().toISOString(),
      requestsIncluded: pricing.requestsIncluded,
      requestsUsed: 0,
      overageCharges: 0,
      billingEmail: options.email || null,
      customerId: null,
      stripeSubscriptionId: null,
      autoUpgrade: options.autoUpgrade !== false,
      notifyAtPercent: options.notifyAtPercent || [50, 80, 90, 100],
    };

    if (this.stripe && options.paymentMethodId) {
      try {
        const customer = await this.stripe.customers.create({
          email: options.email,
          payment_method: options.paymentMethodId,
        });
        subscription.customerId = customer.id;

        const stripeSub = await this.stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: this._getStripePriceId(tier) }],
          metadata: { apiKey },
        });
        subscription.stripeSubscriptionId = stripeSub.id;
      } catch (error) {
        this.logger.error({ error: error.message }, 'Stripe subscription creation failed');
      }
    }

    this.subscriptions.set(apiKey, subscription);
    return subscription;
  }

  async recordUsage(apiKey, count = 1) {
    if (!this.enabled) return { overage: false };

    const sub = this.subscriptions.get(apiKey);
    if (!sub || sub.status !== 'active') return { overage: false };

    sub.requestsUsed += count;

    const overage = sub.requestsUsed > sub.requestsIncluded;
    if (overage) {
      const extra = sub.requestsUsed - sub.requestsIncluded;
      const rate = this.tierPricing[sub.tier]?.overageRate || 0.001;
      sub.overageCharges = extra * rate;
    }

    const pct = Math.round((sub.requestsUsed / sub.requestsIncluded) * 100);
    if (sub.notifyAtPercent.includes(pct)) {
      this._sendUsageNotification(sub, pct).catch(() => {});
    }

    return { overage, usagePercent: pct, overageCharges: sub.overageCharges };
  }

  async upgradeSubscription(apiKey, newTier) {
    const sub = this.subscriptions.get(apiKey);
    if (!sub) throw new Error('No active subscription');

    const oldTier = sub.tier;
    sub.tier = newTier;
    sub.requestsIncluded = this.tierPricing[newTier]?.requestsIncluded || sub.requestsIncluded;

    if (this.stripe && sub.stripeSubscriptionId) {
      try {
        await this.stripe.subscriptions.update(sub.stripeSubscriptionId, {
          items: [{ price: this._getStripePriceId(newTier) }],
          metadata: { previousTier: oldTier },
        });
      } catch (error) {
        this.logger.error({ error: error.message }, 'Stripe upgrade failed');
      }
    }

    this.logger.info({ apiKey: apiKey.slice(0, 8) + '...', oldTier, newTier }, 'Subscription upgraded');
    return sub;
  }

  async suggestUpgrade(apiKey, currentTier, usage) {
    const sub = this.subscriptions.get(apiKey);
    if (!sub || !sub.autoUpgrade) return null;

    const tierOrder = ['free', 'premium', 'enterprise'];
    const idx = tierOrder.indexOf(currentTier);
    if (idx === -1 || idx >= tierOrder.length - 1) return null;

    const nextTier = tierOrder[idx + 1];
    const blockRate = usage.totalRequests > 0 ? usage.totalBlocked / usage.totalRequests : 0;

    if (blockRate > 0.15) {
      this.logger.info({
        apiKey: apiKey.slice(0, 8) + '...',
        currentTier,
        suggestedTier: nextTier,
        blockRate,
      }, 'Upgrade suggested due to high block rate');

      return {
        suggestedTier: nextTier,
        reason: 'high_block_rate',
        blockRate,
        pricing: this.tierPricing[nextTier],
      };
    }

    return null;
  }

  getSubscription(apiKey) {
    return this.subscriptions.get(apiKey) || null;
  }

  async cancelSubscription(apiKey) {
    const sub = this.subscriptions.get(apiKey);
    if (!sub) return null;

    sub.status = 'cancelled';

    if (this.stripe && sub.stripeSubscriptionId) {
      try {
        await this.stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      } catch {
        // silent
      }
    }

    return sub;
  }

  _getStripePriceId(tier) {
    const envKey = `STRIPE_PRICE_${tier.toUpperCase()}`;
    return process.env[envKey] || null;
  }

  _addMonth() {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d;
  }

  async _sendUsageNotification(sub, percent) {
    this.logger.info({
      apiKey: sub.apiKey.slice(0, 8) + '...',
      tier: sub.tier,
      usagePercent: percent,
      requestsUsed: sub.requestsUsed,
      requestsIncluded: sub.requestsIncluded,
    }, 'Usage notification');
  }

  destroy() {
    this.subscriptions.clear();
    this.usageRecords.clear();
  }
}
