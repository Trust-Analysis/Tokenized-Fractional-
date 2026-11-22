import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useTheme } from '../../context/ThemeContext';
import { useGraphQLSubscription } from '../../hooks/useGraphQLSubscription';
import styles from './OrderBookDepthChart.module.css';

const OrderBookDepthChart = ({ contractId, apiUrl }) => {
  const { theme } = useTheme();
  const [depthData, setDepthData] = useState([]);

  useEffect(() => {
    const fetchDepth = async () => {
      try {
        const query = `
          query GetDepth($contractId: String!) {
            orderBookDepth(contractId: $contractId) { price bidVolume askVolume }
          }
        `;
        const res = await fetch(`${apiUrl}/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { contractId } })
        });
        const { data } = await res.json();
        if (data?.orderBookDepth) setDepthData(data.orderBookDepth);
      } catch (err) {
        console.error("Failed to fetch order book depth:", err);
      }
    };
    if (contractId) fetchDepth();
  }, [contractId, apiUrl]);

  const wsUrl = `ws://${new URL(apiUrl || 'http://localhost:3001').host}/ws`;
  useGraphQLSubscription(wsUrl, {
    enabled: !!contractId,
    onEvent: (msg) => {
      if (msg.type === 'DEPTH_UPDATED' && msg.data.contractId === contractId) {
        setDepthData(msg.data.depth);
      }
    }
  });

  const colors = {
    bids: theme === 'dark' ? '#10b981' : '#059669',
    asks: theme === 'dark' ? '#ef4444' : '#dc2626',
    text: theme === 'dark' ? '#9ca3af' : '#4b5563',
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Order Book Depth</h3>
      <div className={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={depthData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <XAxis dataKey="price" stroke={colors.text} />
            <YAxis stroke={colors.text} />
            <Tooltip 
              contentStyle={{ backgroundColor: theme === 'dark' ? '#1f2937' : '#fff', borderColor: theme === 'dark' ? '#374151' : '#e5e7eb' }}
              itemStyle={{ color: colors.text }}
            />
            <Area type="step" dataKey="bidVolume" stroke={colors.bids} fill={colors.bids} fillOpacity={0.3} />
            <Area type="step" dataKey="askVolume" stroke={colors.asks} fill={colors.asks} fillOpacity={0.3} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default OrderBookDepthChart;
