import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

export function createSignatureVerificationMiddleware(options = {}) {
  const {
    secret = process.env.SIGNATURE_SECRET || 'change-me-in-production',
    toleranceMs = DEFAULT_TOLERANCE_MS,
    headerSignature = 'x-signature',
    headerTimestamp = 'x-timestamp',
  } = options;

  return function verifySignature(req, res, next) {
    const signature = req.headers[headerSignature];
    const timestamp = req.headers[headerTimestamp];

    if (!signature || !timestamp) {
      return res.status(401).json({
        error: 'Missing signature headers',
        code: 'MISSING_SIGNATURE_HEADERS',
        requestId: req.requestId,
      });
    }

    const timestampNum = parseInt(timestamp, 10);
    if (isNaN(timestampNum)) {
      return res.status(400).json({
        error: 'Invalid timestamp header',
        code: 'INVALID_TIMESTAMP',
        requestId: req.requestId,
      });
    }

    const now = Date.now();
    if (Math.abs(now - timestampNum) > toleranceMs) {
      return res.status(401).json({
        error: 'Request timestamp is outside tolerance window',
        code: 'TIMESTAMP_TOLERANCE_EXCEEDED',
        requestId: req.requestId,
      });
    }

    const body = typeof req.body === 'object' ? JSON.stringify(req.body) : (req.body || '');
    const payload = `${body}${timestampNum}`;
    const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');

    let signaturesMatch = false;
    try {
      signaturesMatch = timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch {
      return res.status(401).json({
        error: 'Invalid signature format',
        code: 'INVALID_SIGNATURE_FORMAT',
        requestId: req.requestId,
      });
    }

    if (!signaturesMatch) {
      return res.status(401).json({
        error: 'Invalid request signature',
        code: 'INVALID_SIGNATURE',
        requestId: req.requestId,
      });
    }

    req.signatureVerified = true;
    req.signatureTimestamp = timestampNum;
    next();
  };
}
