import { createHmac } from 'crypto';

export function generateSignature(body, secret, timestamp = Date.now()) {
  const bodyStr = typeof body === 'object' ? JSON.stringify(body) : (body || '');
  const payload = `${bodyStr}${timestamp}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return { signature, timestamp };
}
