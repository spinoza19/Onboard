/**
 * GET /api/badge/status?pubkey=… — has this address already been issued a badge.
 *
 * Redis only. No wallet boot, so the frontend can poll it cheaply.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { KEY } from '../_lib/config.js';
import { bad, route } from '../_lib/http.js';
import { redis } from '../_lib/redis.js';

export default route('GET', async (req: VercelRequest, res: VercelResponse) => {
  const pubkey = String(req.query.pubkey ?? '').trim();
  if (!pubkey) throw bad('pubkey is required');

  const raw = await redis().get<string | Record<string, string>>(KEY.badge(pubkey));
  if (!raw) return res.status(200).json({ status: 'pending' });

  const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return res.status(200).json({
    status: 'already-issued',
    tokenId: rec.tokenId,
    issuedAt: rec.issuedAt,
  });
});
