/**
 * GET /api/info — who the issuer is.
 *
 * Hit on every page load, so it must NOT boot a wallet. The identity is cached in
 * Redis by the first `withIssuer` call; this only pays that cost once, on a cold
 * store, and every later request is a single Redis GET.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BADGE_COIN_ID } from './_lib/config.js';
import { route } from './_lib/http.js';
import { cachedIdentity, withIssuer } from './_lib/wallet.js';

export default route('GET', async (_req: VercelRequest, res: VercelResponse) => {
  let identity = await cachedIdentity();

  if (!identity) {
    // Cold store: boot once purely to learn (and cache) who we are.
    const { result } = await withIssuer(async (issuer) => ({
      chainPubkey: issuer.chainPubkey,
      nametag: issuer.nametag,
    }));
    identity = result;
  }

  // Cache at the edge too: this answer changes only when the issuer wallet does.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');

  return res.status(200).json({
    // The pubkey when we hold no nametag: addressing the bot by a name we do not
    // own would send every user's first transfer to whoever does own it.
    welcomeBot: identity.nametag ? `@${identity.nametag}` : identity.chainPubkey,
    hasNametag: Boolean(identity.nametag),
    issuerPubkey: identity.chainPubkey,
    badgeCoinId: BADGE_COIN_ID,
  });
});
