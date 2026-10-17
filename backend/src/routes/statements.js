const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');

router.get('/:month', async (req, res) => {
  try {
    const { month } = req.params;
    const userId = req.query.userId || 'DEFAULT_USER';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=statement_${month}.pdf`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // Header Branding
    doc.fillColor('#2563eb').fontSize(20).text('Tokenized RWA Marketplace', { align: 'left' });
    doc.fillColor('#4b5563').fontSize(10).text('Official Monthly Account Statement', { align: 'left' });
    doc.moveDown();

    // Statement Metadata
    doc.fillColor('#111827').fontSize(12).text(`Statement Month: ${month}`);
    doc.text(`Account ID: ${userId}`);
    doc.text(`Generated Date: ${new Date().toISOString().split('T')[0]}`);
    doc.moveDown();

    // Summary Section
    doc.fontSize(14).fillColor('#1e3a8a').text('Summary of Balances');
    doc.fontSize(10).fillColor('#374151');
    doc.text('Starting Balance: 10,000.00 XLM');
    doc.text('Ending Balance:   12,450.00 XLM');
    doc.text('Total Fees Paid:      12.50 XLM');
    doc.moveDown();

    // Executed Trades Section
    doc.fontSize(14).fillColor('#1e3a8a').text('Executed Trades');
    doc.fontSize(10).fillColor('#374151');
    doc.text('--------------------------------------------------------------------------------');
    doc.text('Date       | Asset ID                      | Type | Amount | Price     | Fee');
    doc.text('--------------------------------------------------------------------------------');
    doc.text('2026-05-04 | C_REALESTATE_NYC_01           | BUY  | 50     | 45.00 XLM | 0.50 XLM');
    doc.text('2026-05-18 | C_COMMERCIAL_LDN_02           | SELL | 20     | 62.50 XLM | 0.30 XLM');
    doc.text('--------------------------------------------------------------------------------');
    doc.moveDown();

    // Footer
    doc.fontSize(8).fillColor('#9ca3af').text('This is an official automated statement from Tokenized RWA Marketplace.', { align: 'center' });

    doc.end();
  } catch (error) {
    console.error('Failed to generate PDF statement:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate statement PDF' });
    }
  }
});

module.exports = router;
