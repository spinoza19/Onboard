/**
 * Client for the issuer backend (server/).
 *
 * The backend is OPTIONAL. Steps 1–4 are pure wallet↔network work and run without
 * it; only step 5 (the badge, which must be minted by the issuer to mean anything)
 * needs it. Every call here fails soft and reports `offline` so the UI can say so
 * honestly instead of showing a spinner forever.
 */

import { API_BASE } from './config';

export interface IssuerInfo {
  /** The nametag the welcome bot answers on — step 4 sends here. */
  welcomeBot: string;
  /** Issuer's chain pubkey, so a user can verify badge provenance. */
  issuerPubkey: string;
  /** Non-fungible type id used for the badge. */
  badgeCoinId: string;
}

export interface BadgeClaim {
  status: 'issued' | 'already-issued' | 'pending';
  tokenId?: string;
  issuedAt?: string;
}

export class BackendOffline extends Error {
  constructor() {
    super('Issuer backend is not reachable');
    this.name = 'BackendOffline';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new BackendOffline();
  }
  // A dev proxy in front of a dead target answers 500/502/503; a missing route
  // answers 404. Either way the issuer is not there — that is not an app error.
  if (res.status === 404 || res.status >= 500) throw new BackendOffline();
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(body.error ?? `Issuer responded ${res.status}`);
  return body;
}

export interface WelcomeResult {
  status: 'replied' | 'already-welcomed' | 'no-transfer-yet';
  dm?: boolean;
  deliveryPending?: boolean;
}

export const issuer = {
  info: () => call<IssuerInfo>('/info'),

  /**
   * Ask the welcome bot to claim the user's transfer and reply.
   *
   * No signature: the issuer verifies the payment itself, which is stronger proof
   * than a signature and saves the user a second wallet popup right behind the
   * send confirmation.
   */
  welcome: (payload: { chainPubkey: string; nametag?: string }) =>
    call<WelcomeResult>('/welcome', { method: 'POST', body: JSON.stringify(payload) }),

  /**
   * Ask the issuer to mint the completion badge and send it to `chainPubkey`.
   *
   * The signature proves the caller holds the key for that pubkey — without it
   * anyone could farm badges for addresses they do not control.
   */
  claimBadge: (payload: {
    chainPubkey: string;
    nametag?: string;
    message: string;
    signature: string;
  }) => call<BadgeClaim>('/badge/claim', { method: 'POST', body: JSON.stringify(payload) }),

  badgeStatus: (chainPubkey: string) =>
    call<BadgeClaim>(`/badge/status?pubkey=${encodeURIComponent(chainPubkey)}`),
};
