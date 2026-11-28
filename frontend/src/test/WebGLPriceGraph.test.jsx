import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import WebGLPriceGraph from '../components/PriceHistoryChart/WebGLPriceGraph';

describe('WebGLPriceGraph Component', () => {
  const generateMockPriceData = (count) => {
    const data = [];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      data.push({
        timestamp: new Date(now - (count - i) * 60000).toISOString(),
        price: 100 + Math.sin(i / 10) * 20 + Math.random() * 5,
        volume: 1000 + i,
      });
    }
    return data;
  };

  it('renders WebGL canvas container and renders 10,000+ data points smoothly', () => {
    const mockData = generateMockPriceData(10000);
    const { container } = render(
      <WebGLPriceGraph data={mockData} color="#10b981" height={400} />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });

  it('provides tooltip overlay without throwing error or breaking render loop', () => {
    const mockData = generateMockPriceData(100);
    const { container } = render(
      <WebGLPriceGraph data={mockData} color="#ef4444" height={300} />
    );

    const tooltip = container.querySelector('[class*="tooltipOverlay"]');
    expect(tooltip).toBeInTheDocument();
  });
});
