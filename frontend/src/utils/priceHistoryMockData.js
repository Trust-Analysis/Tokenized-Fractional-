/**
 * Mock Data Generator for Price History
 *
 * Generates realistic price history data for testing and development
 * Supports various time ranges and price volatility patterns
 */

/**
 * Generate mock price history data
 * @param {number} days - Number of days to generate data for
 * @param {number} basePrice - Starting price (default: random 1000-6000)
 * @param {number} volatility - Daily volatility percentage (default: 0.05 = 5%)
 * @returns {Array} Array of price data points
 */
export function generateMockPriceData(days = 30, basePrice = null, volatility = 0.05) {
  const data = [];
  const startPrice = basePrice ?? Math.random() * 5000 + 1000;
  const now = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    // Generate realistic price with trend and noise
    const trend = ((days - i) / days) * 0.02; // 2% trend over period
    const noise = (Math.random() - 0.5) * 2 * volatility;
    const price = startPrice * (1 + trend + noise);

    const previousPrice = data.length > 0 ? data[data.length - 1].price : startPrice;
    const change = price - previousPrice;
    const changePercent = (change / previousPrice) * 100;

    data.push({
      date: date.toISOString().split('T')[0],
      timestamp: date.getTime(),
      price: Math.round(price * 100) / 100,
      volume: Math.floor(Math.random() * 1000 + 100),
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
    });
  }

  return data;
}

/**
 * Generate multiple asset price histories
 * @param {number} count - Number of assets to generate
 * @param {number} days - Days of history per asset
 * @returns {Object} Object with asset contract IDs as keys
 */
export function generateMultipleMockAssets(count = 5, days = 30) {
  const assets = {};

  for (let i = 0; i < count; i++) {
    const contractId = `CBUILD${String(i + 1).padStart(5, '0')}`;
    const basePrice = Math.random() * 5000 + 1000;
    assets[contractId] = {
      contractId,
      title: `Asset ${i + 1}`,
      priceData: generateMockPriceData(days, basePrice),
    };
  }

  return assets;
}

/**
 * Asset templates for realistic mock data
 */
const ASSET_TEMPLATES = [
  {
    title: 'Manhattan Office Tower',
    location: 'New York, NY',
    type: 'commercial_real_estate',
    basePrice: 3500,
  },
  {
    title: 'Waterfront Residential Complex',
    location: 'Miami, FL',
    type: 'residential_real_estate',
    basePrice: 2800,
  },
  {
    title: 'Downtown Mixed-Use Development',
    location: 'San Francisco, CA',
    type: 'commercial_real_estate',
    basePrice: 4200,
  },
  {
    title: 'Luxury Apartment Building',
    location: 'Los Angeles, CA',
    type: 'residential_real_estate',
    basePrice: 2200,
  },
  {
    title: 'Industrial Warehouse Complex',
    location: 'Dallas, TX',
    type: 'industrial_real_estate',
    basePrice: 1500,
  },
  {
    title: 'Tech Campus Development',
    location: 'Austin, TX',
    type: 'commercial_real_estate',
    basePrice: 3800,
  },
  {
    title: 'Shopping Mall',
    location: 'Chicago, IL',
    type: 'commercial_real_estate',
    basePrice: 2600,
  },
  {
    title: 'Luxury Resort Property',
    location: 'Maui, Hawaii',
    type: 'hospitality_real_estate',
    basePrice: 5200,
  },
];

/**
 * Generate realistic mock asset with price history
 * @param {number} index - Asset index for template selection
 * @param {number} days - Days of price history
 * @returns {Object} Complete asset object with price history
 */
export function generateRealisticMockAsset(index = 0, days = 30) {
  const template = ASSET_TEMPLATES[index % ASSET_TEMPLATES.length];
  const contractId = `C${String(index).padStart(10, '0')}TOKENIZED`;

  return {
    contractId,
    title: template.title,
    location: template.location,
    assetType: template.type,
    totalValuation: `$${(template.basePrice * 1000).toLocaleString()}`,
    pricePerShare: template.basePrice,
    totalShares: 1000,
    availableShares: Math.floor(Math.random() * 500 + 100),
    priceData: generateMockPriceData(days, template.basePrice, 0.04),
  };
}

/**
 * Generate multiple realistic mock assets
 * @param {number} count - Number of assets
 * @param {number} days - Days of price history per asset
 * @returns {Array} Array of realistic mock assets
 */
export function generateRealisticMockAssets(count = 5, days = 30) {
  const assets = [];

  for (let i = 0; i < Math.min(count, ASSET_TEMPLATES.length); i++) {
    assets.push(generateRealisticMockAsset(i, days));
  }

  return assets;
}

/**
 * Test data for specific scenarios
 */
export const TEST_SCENARIOS = {
  // Bullish scenario - steady uptrend
  bullish: (days = 30) => {
    const data = [];
    const basePrice = 2000;
    const now = new Date();

    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const uptrend = ((days - i) / days) * 0.15; // 15% total uptrend
      const noise = (Math.random() - 0.5) * 0.02;
      const price = basePrice * (1 + uptrend + noise);

      data.push({
        date: date.toISOString().split('T')[0],
        timestamp: date.getTime(),
        price: Math.round(price * 100) / 100,
        volume: Math.floor(Math.random() * 1000 + 100),
        change: 0,
        changePercent: 0,
      });
    }

    return data;
  },

  // Bearish scenario - steady downtrend
  bearish: (days = 30) => {
    const data = [];
    const basePrice = 3000;
    const now = new Date();

    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const downtrend = (-(days - i) / days) * 0.12; // 12% total downtrend
      const noise = (Math.random() - 0.5) * 0.02;
      const price = basePrice * (1 + downtrend + noise);

      data.push({
        date: date.toISOString().split('T')[0],
        timestamp: date.getTime(),
        price: Math.round(price * 100) / 100,
        volume: Math.floor(Math.random() * 1000 + 100),
        change: 0,
        changePercent: 0,
      });
    }

    return data;
  },

  // Volatile scenario - high swings
  volatile: (days = 30) => {
    const data = [];
    const basePrice = 2500;
    const now = new Date();

    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const volatility = (Math.random() - 0.5) * 2 * 0.15; // 15% volatility
      const trend = Math.sin(i / 5) * 0.1; // Cyclic pattern
      const price = basePrice * (1 + volatility + trend);

      data.push({
        date: date.toISOString().split('T')[0],
        timestamp: date.getTime(),
        price: Math.round(price * 100) / 100,
        volume: Math.floor(Math.random() * 2000 + 200),
        change: 0,
        changePercent: 0,
      });
    }

    return data;
  },

  // Stable scenario - minimal movement
  stable: (days = 30) => {
    const data = [];
    const basePrice = 2000;
    const now = new Date();

    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const noise = (Math.random() - 0.5) * 0.01; // 1% noise only
      const price = basePrice * (1 + noise);

      data.push({
        date: date.toISOString().split('T')[0],
        timestamp: date.getTime(),
        price: Math.round(price * 100) / 100,
        volume: Math.floor(Math.random() * 200 + 50),
        change: 0,
        changePercent: 0,
      });
    }

    return data;
  },

  // Flash crash scenario - sudden drop and recovery
  flashCrash: (days = 30) => {
    const data = [];
    const basePrice = 3000;
    const now = new Date();
    const crashDay = Math.floor(days / 2);

    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      let price;
      if (i === crashDay) {
        price = basePrice * 0.7; // 30% drop
      } else if (i < crashDay) {
        // Recovery
        const recovery = ((crashDay - i) / crashDay) * 0.3;
        price = basePrice * (0.7 + recovery);
      } else {
        // Normal trend before crash
        price = basePrice;
      }

      const noise = (Math.random() - 0.5) * 0.02;
      price *= 1 + noise;

      data.push({
        date: date.toISOString().split('T')[0],
        timestamp: date.getTime(),
        price: Math.round(price * 100) / 100,
        volume: Math.floor(Math.random() * 1000 + 100),
        change: 0,
        changePercent: 0,
      });
    }

    return data;
  },
};

export default {
  generateMockPriceData,
  generateMultipleMockAssets,
  generateRealisticMockAsset,
  generateRealisticMockAssets,
  TEST_SCENARIOS,
};
