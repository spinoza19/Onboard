/**
 * Proving that a caller actually holds the key for the address they claim.
 *
 * Without this, anyone could POST a stranger's pubkey and farm badges — or drain
 * the welcome payout — for addresses they do not control. `verifySignedMessage`
 * recovers the public key from the signature, so no key material is ever involved
 * on our side; we only compare what came back.
 */

import { verifySignedMessage } from '@unicitylabs/sphere-sdk';

import { CHALLENGE_TTL_MS } from './config.js';
import { bad } from './http.js';

export interface SignedClaim {
  chainPubkey?: string;
  nametag?: string;
  message?: string;
  signature?: string;
}

/**
 * Throws unless the signature is valid for `chainPubkey`, the challenge names that
 * same address, and it was issued recently.
 *
 * The freshness window matters: a signature is a bearer token for as long as we
 * accept it, so one captured from a browser history or a log must expire.
 */
export function verifyClaim(input: SignedClaim): {
  chainPubkey: string;
  nametag?: string;
} {
  const { chainPubkey, nametag, message, signature } = input;

  if (!chainPubkey || !message || !signature) {
    throw bad('chainPubkey, message and signature are required');
  }

  let ok = false;
  try {
    ok = verifySignedMessage(message, signature, chainPubkey);
  } catch {
    ok = false;
  }
  if (!ok) throw bad('Signature does not match that address', 401);

  // Binds the signature to this address: a valid signature over someone else's
  // challenge must not authorise a payout to the sender.
  if (!message.includes(chainPubkey)) {
    throw bad('Challenge does not name the claiming address');
  }

  const issuedAt = /Issued At: (.+)/.exec(message)?.[1];
  const age = issuedAt ? Date.now() - Date.parse(issuedAt) : NaN;
  if (!Number.isFinite(age)) throw bad('Challenge has no readable timestamp');
  // A little tolerance backwards for clock skew; none worth having forwards.
  if (age < -60_000 || age > CHALLENGE_TTL_MS) {
    throw bad('Challenge expired — reload the page and sign a fresh one');
  }

  return { chainPubkey, nametag };
}

/** Recipient the wallet can actually resolve: prefer the nametag, fall back to the key. */
export function recipientOf(claim: { chainPubkey: string; nametag?: string }): string {
  return claim.nametag ? `@${claim.nametag}` : claim.chainPubkey;
}
