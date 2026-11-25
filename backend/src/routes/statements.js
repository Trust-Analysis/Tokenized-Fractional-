import express from 'express';
import PDFDocument from 'pdfkit';
import { logger } from '../../logger.js';

const router = express.Router();

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

    doc.end();
  } catch (error) {
    logger.error({ err: error, month: req.params?.month }, 'Failed to generate PDF statement');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate statement PDF' });
    }
  }
});

export default router;
