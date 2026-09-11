/**
 * Issuer configuration, read once per cold start.
 *
 * Everything that differs between deployments is an env var; everything that is
 * a protocol constant is hard-coded, because a typo'd coin id is a silent
 * wrong-token bug rather than a crash.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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

export interface MnemonicCheck {
  present: boolean;
  words: number;
  valid: boolean;
  /** Why it was rejected, in terms a human can act on. Never quotes the phrase. */
  reason?: string;
  /** 1-based positions of words absent from the BIP39 list. Positions only, no words. */
  badWordPositions?: number[];
}

/**
 * Clean up a pasted mnemonic.
 *
 * A dashboard paste is not a clean string: it arrives wrapped in quotes, with a
 * trailing newline, with the double spaces a terminal wrapped it at, or in mixed
 * case. None of that changes the user's intent and all of it makes BIP39 reject
 * the phrase, so it is normalised rather than blamed.
 */
export function normaliseMnemonic(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Diagnose the configured mnemonic without revealing it.
 *
 * Reports counts and positions only — never a word. "Invalid mnemonic" thrown from
 * deep inside the SDK says nothing about whether you pasted eleven words, a typo,
 * or something that is not a mnemonic at all, and that distinction is the whole
 * difference between a one-minute fix and an afternoon.
 */
export function checkMnemonic(raw = process.env.MNEMONIC): MnemonicCheck {
  const phrase = normaliseMnemonic(raw);
  if (!phrase) return { present: false, words: 0, valid: false, reason: 'MNEMONIC is not set' };

  const words = phrase.split(' ');
  const count = words.length;
  const base: MnemonicCheck = { present: true, words: count, valid: false };

  if (![12, 15, 18, 21, 24].includes(count)) {
    return { ...base, reason: `Expected 12, 15, 18, 21 or 24 words — got ${count}` };
  }

  // Required lazily: a bad env var must not be able to crash the diagnostic itself.
  let bip39: { validateMnemonic(m: string): boolean; wordlists: Record<string, string[]> };
  try {
    bip39 = require('bip39');
  } catch {
    return { ...base, reason: 'bip39 is unavailable in this runtime' };
  }

  const list = new Set(bip39.wordlists.english);
  const badWordPositions = words
    .map((w, i) => (list.has(w) ? 0 : i + 1))
    .filter((i): i is number => i > 0);

  if (badWordPositions.length) {
    return {
      ...base,
      badWordPositions,
      reason: `${badWordPositions.length} word(s) are not in the BIP39 English list`,
    };
  }

  if (!bip39.validateMnemonic(phrase)) {
    return {
      ...base,
      reason: 'Every word is valid but the checksum is not — a word is in the wrong place, or one was swapped',
    };
  }

  return { ...base, valid: true };
}

/** The mnemonic is the issuer's identity. No default — an absent one must fail loudly. */
export function mnemonic(): string {
  const check = checkMnemonic();
  if (!check.valid) {
    throw new Error(
      `MNEMONIC is unusable: ${check.reason}. Set it in the project environment ` +
        'variables (never in the repo), then redeploy.',
    );
  }
  return normaliseMnemonic(process.env.MNEMONIC);
}
