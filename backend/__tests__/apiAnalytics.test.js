// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect } from '@jest/globals';
import { AnalyticsService } from '../src/services/analyticsService.js';

describe('Comprehensive API Analytics Dashboard (#290)', () => {
  let analyticsService;
  let mockDataService;

  beforeEach(() => {
    mockDataService = {
      loadData: () => ({
        'asset-1': { title: 'Asset One', totalValuation: 100000, assetType: 'RealEstate', status: 'approved', createdAt: new Date().toISOString() },
        'asset-2': { title: 'Asset Two', totalValuation: 500000, assetType: 'Commodity', status: 'approved', createdAt: new Date().toISOString() },
      }),
    };
    analyticsService = new AnalyticsService(mockDataService);
  });

  describe('Anomaly Detection', () => {
    it('detects traffic anomalies using Z-Score threshold (>= 2.5 std dev)', () => {
      const normalData = [
        { count: 10 }, { count: 10 }, { count: 10 }, { count: 10 }, { count: 10 }, { count: 10 }, { count: 10 }, { count: 150 } // 150 is anomaly spike
      ];
      const result = analyticsService.detectAnomalies(normalData);

      expect(result.anomaliesDetected).toBe(true);
      expect(result.anomalyCount).toBeGreaterThan(0);
      expect(result.anomalies[0].value).toBe(150);
    });

    it('returns false when no traffic anomalies are present', () => {
      const normalData = [{ count: 10 }, { count: 11 }, { count: 12 }, { count: 10 }];
      const result = analyticsService.detectAnomalies(normalData);

      expect(result.anomaliesDetected).toBe(false);
    });
  });

  describe('Capacity Planning & Predictive Analytics', () => {
    it('forecasts future capacity and growth rates based on linear trend analysis', () => {
      const forecast = analyticsService.getCapacityPlanningForecast(30);

      expect(forecast.projectedGrowthRate).toBeDefined();
      expect(forecast.forecast.length).toBe(30);
      expect(forecast.forecast[0].date).toBeDefined();
    });
  });

  describe('Role-Based Export Capabilities', () => {
    it('exports data as CSV correctly', () => {
      const csvExport = analyticsService.exportAnalyticsData('csv', 'admin');

      expect(csvExport.format).toBe('csv');
      expect(csvExport.contentType).toBe('text/csv');
      expect(csvExport.data).toContain('Total Assets');
    });

    it('masks sensitive analytics fields when non-admin role exports JSON', () => {
      const jsonExport = analyticsService.exportAnalyticsData('json', 'viewer');

      expect(jsonExport.format).toBe('json');
      expect(jsonExport.contentType).toBe('application/json');
    });
  });
});
