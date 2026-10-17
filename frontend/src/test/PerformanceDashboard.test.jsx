// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for frontend/src/components/PerformanceDashboard/PerformanceDashboard.jsx
 *
 * Covers:
 *  - Dashboard renders without crashing
 *  - Header title is visible
 *  - Close button calls onClose callback
 *  - Core Web Vitals section renders metric rows
 *  - "No data yet" placeholder shown when buffer is empty
 *  - Metrics populate from the buffer after reporting
 *  - RUM context section appears when LCP data is present
 *  - Refresh button triggers a re-poll of metrics
 *
 * Issue: #370 (Comprehensive Unit Test Coverage Expansion)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('@sentry/react', () => ({
  getCurrentScope: vi.fn(() => ({ setTag: vi.fn() })),
  captureMessage: vi.fn(),
  metrics: { set: vi.fn() },
}));

// Mock the performance monitoring service so we control what the dashboard sees
vi.mock('../../services/performanceMonitoring', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    getCollectedMetrics: vi.fn(() => []),
    PERFORMANCE_BUDGETS: original.PERFORMANCE_BUDGETS,
  };
});

import { getCollectedMetrics, PERFORMANCE_BUDGETS } from '../../services/performanceMonitoring';
import PerformanceDashboard from '../../components/PerformanceDashboard/PerformanceDashboard';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

/** Builds a metric entry matching what the real service would push into the buffer */
function makeEntry(name, value, rating, extras = {}) {
  return {
    name,
    value,
    rawValue: value,
    id: `test-${name}-${Date.now()}`,
    rating,
    timestamp: Date.now(),
    page: '/',
    deviceType: 'desktop',
    connectionType: '4g',
    viewport: '1440x900',
    ...extras,
  };
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty buffer
  getCollectedMetrics.mockReturnValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Render tests ─────────────────────────────────────────────────────────────

describe('PerformanceDashboard', () => {
  it('renders without crashing', () => {
    expect(() => render(<PerformanceDashboard onClose={() => {}} />)).not.toThrow();
  });

  it('displays the dashboard title', () => {
    render(<PerformanceDashboard onClose={() => {}} />);
    expect(screen.getByText(/Performance Dashboard/i)).toBeInTheDocument();
  });

  it('has the correct ARIA landmark', () => {
    render(<PerformanceDashboard onClose={() => {}} />);
    expect(screen.getByRole('complementary', { name: /Performance Dashboard/i })).toBeInTheDocument();
  });
});

// ─── Close button ─────────────────────────────────────────────────────────────

describe('PerformanceDashboard close button', () => {
  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<PerformanceDashboard onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close performance dashboard/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─── Core Web Vitals section ──────────────────────────────────────────────────

describe('PerformanceDashboard Core Web Vitals', () => {
  it('shows all six Core Web Vital names', () => {
    render(<PerformanceDashboard onClose={() => {}} />);
    ['LCP', 'FID', 'CLS', 'FCP', 'TTFB', 'INP'].forEach((name) => {
      expect(screen.getByText(name)).toBeInTheDocument();
    });
  });

  it('shows "—" placeholder for metrics with no data', () => {
    render(<PerformanceDashboard onClose={() => {}} />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('renders a metric value when data is available', async () => {
    getCollectedMetrics.mockReturnValue([
      makeEntry('LCP', 1200, 'good'),
    ]);
    render(<PerformanceDashboard onClose={() => {}} />);
    // Wait for the polling interval or immediate refresh
    await waitFor(() => {
      expect(screen.queryByText('1200ms')).toBeInTheDocument();
    });
  });

  it('shows "good" rating badge for a good LCP', async () => {
    getCollectedMetrics.mockReturnValue([
      makeEntry('LCP', 1200, 'good'),
    ]);
    render(<PerformanceDashboard onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('good')).toBeInTheDocument();
    });
  });

  it('shows "poor" rating badge for a poor LCP', async () => {
    getCollectedMetrics.mockReturnValue([
      makeEntry('LCP', 6000, 'poor'),
    ]);
    render(<PerformanceDashboard onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('poor')).toBeInTheDocument();
    });
  });

  it('formats CLS as a decimal value (not ms)', async () => {
    getCollectedMetrics.mockReturnValue([
      makeEntry('CLS', 0.05, 'good'),
    ]);
    render(<PerformanceDashboard onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('0.0500')).toBeInTheDocument();
    });
  });
});

// ─── App Metrics section ──────────────────────────────────────────────────────

describe('PerformanceDashboard App Metrics', () => {
  it('shows "No data yet" when no APP_METRIC entries exist', () => {
    render(<PerformanceDashboard onClose={() => {}} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('renders APP_METRIC entries from the buffer', async () => {
    getCollectedMetrics.mockReturnValue([
      makeEntry('APP_METRIC', 350, 'good', {
        label: 'AssetGrid:fetch-assets',
      }),
    ]);
    render(<PerformanceDashboard onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('AssetGrid:fetch-assets')).toBeInTheDocument();
    });
  });
});

// ─── RUM Context section ──────────────────────────────────────────────────────

describe('PerformanceDashboard RUM Context', () => {
  it('does not show RUM context when no LCP data is available', () => {
    render(<PerformanceDashboard onClose={() => {}} />);
    expect(screen.queryByText('RUM Context')).not.toBeInTheDocument();
  });

  it('shows RUM context when LCP data is present', async () => {
    getCollectedMetrics.mockReturnValue([
      makeEntry('LCP', 2000, 'good'),
    ]);
    render(<PerformanceDashboard onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('RUM Context')).toBeInTheDocument();
    });
  });

  it('displays device type from LCP metric context', async () => {
    getCollectedMetrics.mockReturnValue([
      makeEntry('LCP', 2000, 'good', { deviceType: 'mobile', connectionType: '3g' }),
    ]);
    render(<PerformanceDashboard onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText('mobile')).toBeInTheDocument();
    });
  });
});

// ─── Refresh button ───────────────────────────────────────────────────────────

describe('PerformanceDashboard Refresh button', () => {
  it('calls getCollectedMetrics when the refresh button is clicked', () => {
    render(<PerformanceDashboard onClose={() => {}} />);
    const initialCallCount = getCollectedMetrics.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /↻ Refresh/i }));
    expect(getCollectedMetrics.mock.calls.length).toBeGreaterThan(initialCallCount);
  });
});
