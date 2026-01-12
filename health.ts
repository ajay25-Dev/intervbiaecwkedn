import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  return res.json({
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    platform: 'vercel',
    environment: process.env.NODE_ENV || 'development'
  });
}