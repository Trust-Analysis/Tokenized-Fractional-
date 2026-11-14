import React from 'react';
import { exportTransactionsToCSV } from '../../utils/csvExport';

export default function ExportCSVButton({ transactions = [], dateRange = null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
      <button
        onClick={() => exportTransactionsToCSV(transactions, dateRange)}
        style={{
          background: '#2563eb',
          color: '#ffffff',
          border: 'none',
          padding: '8px 16px',
          borderRadius: '6px',
          fontWeight: '600',
          cursor: 'pointer',
          display: 'flex',
          alignId: 'center',
          gap: '6px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}
        className="hover:bg-blue-700 transition"
      >
        📥 Export CSV
      </button>
    </div>
  );
}
