/**
 * POST /api/badge/claim — mint the completion badge and send it to the claimant.
 *
 * The reason this endpoint exists at all: the `mint` Connect intent is a SELF-mint
 * of a fungible token, so a badge the user mints for themselves is worth exactly as
 * many as they care to make. Only an issuer-minted token carries provenance.
 *
 * Order of operations is deliberate:
 *   1. verify the signature BEFORE taking the lock — a forged claim should cost
 *      nobody else their turn;
 *   2. re-check the ledger INSIDE the lock — two tabs racing must mint once;
 *   3. record the ledger entry in the same critical section as the mint.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BADGE_COIN_ID, KEY } from '../_lib/config.js';
import { recipientOf, verifyClaim } from '../_lib/challenge.js';
import { body, route } from '../_lib/http.js';
import { redis } from '../_lib/redis.js';
import { withIssuer } from '../_lib/wallet.js';

interface BadgeRecord {
  tokenId?: string;
  nametag?: string;
  issuedAt: string;
}

export default route('POST', async (req: VercelRequest, res: VercelResponse) => {
  const claim = verifyClaim(body(req));
  const ledgerKey = KEY.badge(claim.chainPubkey);

  // Cheap pre-check: most repeat claims never need to wake a wallet at all.
  const existing = await redis().get<string | BadgeRecord>(ledgerKey);
  if (existing) {
    const rec = (typeof existing === 'string' ? JSON.parse(existing) : existing) as BadgeRecord;
    return res
      .status(200)
      .json({ status: 'already-issued', tokenId: rec.tokenId, issuedAt: rec.issuedAt });
  }

  const { result, timings } = await withIssuer(async ({ sphere }) => {
    // Inside the lock now. Re-read: another request may have issued between the
    // pre-check above and this line, and minting twice is the one thing the
    // ledger exists to prevent.
    const raced = await redis().get<string | BadgeRecord>(ledgerKey);
    if (raced) {
      const rec = (typeof raced === 'string' ? JSON.parse(raced) : raced) as BadgeRecord;
      return { status: 'already-issued' as const, tokenId: rec.tokenId, issuedAt: rec.issuedAt };
    }

    const minted = await sphere.payments.mint(BADGE_COIN_ID, 1n);
    if (!minted?.success) throw new Error(minted?.error ?? 'The token engine refused the mint');

    const sent = await sphere.payments.send({
      recipient: recipientOf(claim),
      amount: '1',
      coinId: BADGE_COIN_ID,
      memo: 'ONBOARD completion badge',
    });

    const record: BadgeRecord = {
      tokenId: minted.tokenId,
      nametag: claim.nametag,
      issuedAt: new Date().toISOString(),
    };
    await redis().set(ledgerKey, JSON.stringify(record));

    // 'pending' when the spend is committed but delivery is still retrying — the
    // badge is on its way, and saying 'issued' would invite a pointless re-claim.
    return {
      status: sent?.deliveryState === 'pending-delivery' ? ('pending' as const) : ('issued' as const),
      tokenId: record.tokenId,
      issuedAt: record.issuedAt,
    };
  });

  // Surfaced so the cold-start cost of this design is measurable in production
  // rather than a thing we guess about.
  console.log('[badge/claim] timings', timings);

  return res.status(200).json({ ...result, timings });
});
