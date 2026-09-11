/**
 * Issuer configuration, read once per cold start.
 *
 * Everything that differs between deployments is an env var; everything that is
 * a protocol constant is hard-coded, because a typo'd coin id is a silent
 * wrong-token bug rather than a crash.
 */

export const NETWORK = 'testnet2';

/** Documented by the SDK as public, not a secret. Override per deployment. */
export const GATEWAY_KEY =
  process.env.GATEWAY_API_KEY ?? 'sk_ddc3cfcc001e4a28ac3fad7407f99590';

export const WALLET_API_URL =
  process.env.WALLET_API_URL ?? 'https://wallet-api.unicity.network';

export const BOT_NAMETAG = process.env.BOT_NAMETAG ?? 'welcome';

/** USDU — 6 decimals. The coin the whole wizard is denominated in. */
export const USDU = '8f0f3d7a5e7297be0ee98c63b81bcebb2740f43f616566fc290f9823a54f52d7';

/**
 * The badge's coin id, minted at quantity 1. Its meaning comes from WHO issued
 * it — provenance against the issuer pubkey — not from a non-fungible flag.
 */
export const BADGE_COIN_ID =
  process.env.BADGE_COIN_ID ??
  '0b0a4d0e0b0a4d0e0b0a4d0e0b0a4d0e0b0a4d0e0b0a4d0e0b0a4d0e0b0a4d0e';

/** What the bot sends back on a welcome reply. 1 USDU. */
export const REPLY_AMOUNT = process.env.REPLY_AMOUNT ?? '1000000';

/** Signatures older than this are refused, so a captured one cannot be replayed. */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/**
 * Redis keys. The wallet blob is the whole `wallet.json` the SDK's file provider
 * would have written — see wallet.ts for why it is stored whole.
 */
export const KEY = {
  wallet: `onboard:${NETWORK}:wallet`,
  lock: `onboard:${NETWORK}:lock`,
  /** Cached issuer identity, so /api/info never has to boot a wallet. */
  identity: `onboard:${NETWORK}:identity`,
  badge: (pubkey: string) => `onboard:${NETWORK}:badge:${pubkey}`,
  welcomed: (pubkey: string) => `onboard:${NETWORK}:welcomed:${pubkey}`,
} as const;

/** The mnemonic is the issuer's identity. No default — an absent one must fail loudly. */
export function mnemonic(): string {
  const m = process.env.MNEMONIC?.trim();
  if (!m) {
    throw new Error(
      'MNEMONIC is not set. The issuer has no wallet without it — add it to the ' +
        'project environment variables (and never to the repo).',
    );
  }
  return m;
}
