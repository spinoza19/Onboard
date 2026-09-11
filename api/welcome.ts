/**
 * POST /api/welcome — the welcome bot, as an endpoint instead of a listener.
 *
 * The always-on version subscribed to `transfer:incoming` and replied when money
 * landed. A function cannot hold that subscription between requests, so the trigger
 * moves to the frontend: step 4 calls this right after its send resolves.
 *
 * The trade, stated honestly: it is FASTER when the user stays on the page — no
 * subscription round-trip, the reply is already in flight. It is worse if they close
 * the tab immediately after sending, because nothing is listening to catch up later.
 *
 * AUTHORISATION — no signature, deliberately. This endpoint pays real tokens out, so
 * an open version is a faucet for anyone with curl. But asking for `sign_message`
 * here would put a second wallet popup directly behind the send confirmation, which
 * is exactly the friction the wizard exists to remove. Instead the PAYMENT is the
 * proof: we claim the pending transfer and look for one that actually came from the
 * caller's address. You cannot forge that without having sent us the money, which
 * makes the endpoint self-limiting in a way a signature never was.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { KEY, REPLY_AMOUNT, USDU } from './_lib/config';
import { bad, body, route } from './_lib/http';
import { redis } from './_lib/redis';
import { withIssuer } from './_lib/wallet';

interface HistoryRow {
  type?: string;
  senderPubkey?: string;
  senderNametag?: string;
}

export default route('POST', async (req: VercelRequest, res: VercelResponse) => {
  const { chainPubkey, nametag } = body<{ chainPubkey?: string; nametag?: string }>(req);
  if (!chainPubkey) throw bad('chainPubkey is required');

  const key = KEY.welcomed(chainPubkey);
  if (await redis().get(key)) {
    return res.status(200).json({ status: 'already-welcomed' });
  }

  const { result, timings } = await withIssuer(async ({ sphere }) => {
    if (await redis().get(key)) return { status: 'already-welcomed' as const };

    // Claim whatever is waiting in the mailbox. This is also what makes the check
    // below meaningful — an unclaimed transfer is not yet in our history.
    try {
      await sphere.payments.receive();
    } catch (e) {
      console.warn('[welcome] receive failed:', (e as Error).message);
    }

    const history = await sphere.payments.history();
    const rows: HistoryRow[] = Array.isArray(history) ? history : (history?.entries ?? []);

    const paid = rows.some(
      (h) =>
        h.type === 'RECEIVED' &&
        (h.senderPubkey === chainPubkey ||
          (!!nametag && h.senderNametag?.toLowerCase() === nametag.toLowerCase())),
    );

    // Not an error the user caused: a certified transfer can still be in flight to
    // our mailbox. 202 says "ask again", which is what the frontend does.
    if (!paid) return { status: 'no-transfer-yet' as const };

    const to = nametag ? `@${nametag}` : chainPubkey;

    // Best-effort: a Nostr relay handshake inside a request is the flakiest thing
    // here, and a missing DM must not cost the user their reply.
    let dm = false;
    try {
      await sphere.communications?.sendDM(
        to,
        'Welcome to Unicity. That transfer went peer-to-peer — no gas auction, no ' +
          'pending block, and the tokens were in your own custody the whole time. ' +
          'Here is a little back.',
      );
      dm = true;
    } catch (e) {
      console.warn('[welcome] DM failed:', (e as Error).message);
    }

    const sent = await sphere.payments.send({
      recipient: to,
      amount: REPLY_AMOUNT,
      coinId: USDU,
      memo: 'welcome back',
    });

    // Recorded only after the send resolved: a failure should leave the user
    // eligible to try again rather than silently owed.
    await redis().set(key, new Date().toISOString());

    return {
      status: 'replied' as const,
      dm,
      deliveryPending: sent?.deliveryState === 'pending-delivery',
    };
  });

  console.log('[welcome] timings', timings);
  return res.status(result.status === 'no-transfer-yet' ? 202 : 200).json({ ...result, timings });
});
