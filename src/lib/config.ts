/**
 * Every tunable in one place. Anything that touches money is defined here in
 * BASE UNITS as a string, because that is what the Connect wire expects —
 * never a float, never a symbol.
 */

import { SPHERE_NETWORKS, PERMISSION_SCOPES } from '@unicitylabs/sphere-sdk/connect';
import type { PermissionScope } from '@unicitylabs/sphere-sdk/connect';

/** The only live Unicity network today. `id: 4`. */
export const NETWORK = SPHERE_NETWORKS.testnet2;

/** Where the hosted Sphere wallet lives (popup fallback, and the nametag hand-off). */
export const WALLET_URL =
  import.meta.env.VITE_WALLET_URL ?? 'https://sphere.unicity.network';

export const DAPP = {
  name: 'ONBOARD',
  description: 'Five steps from an empty wallet to a working Unicity identity.',
  url: typeof location !== 'undefined' ? location.origin : 'http://localhost:5174',
} as const;

/**
 * We ask for exactly what the five steps need and nothing more. A wallet
 * approval modal listing scopes the dApp never uses is a trust leak.
 */
export const SCOPES: PermissionScope[] = [
  PERMISSION_SCOPES.IDENTITY_READ,
  PERMISSION_SCOPES.BALANCE_READ,
  PERMISSION_SCOPES.TOKENS_READ,
  PERMISSION_SCOPES.HISTORY_READ,
  PERMISSION_SCOPES.EVENTS_SUBSCRIBE,
  PERMISSION_SCOPES.RESOLVE_PEER,
  PERMISSION_SCOPES.TRANSFER_REQUEST,
  PERMISSION_SCOPES.MINT_REQUEST,
  // Step 5 proves key ownership to the issuer before it mints a badge.
  PERMISSION_SCOPES.SIGN_REQUEST,
];

/** Canonical lowercase 64-hex coin ids from the SDK's testnet registry. */
export interface Coin {
  readonly id: string;
  readonly symbol: string;
  readonly decimals: number;
}

export const COINS = {
  USDU: {
    id: '8f0f3d7a5e7297be0ee98c63b81bcebb2740f43f616566fc290f9823a54f52d7',
    symbol: 'USDU',
    decimals: 6,
  },
  UCT: {
    id: '455ad8720656b08e8dbd5bac1f3c73eeea5431565f6c1c3af742b1aa12d41d89',
    symbol: 'UCT',
    decimals: 18,
  },
} as const satisfies Record<string, Coin>;

/** The coin the whole wizard is denominated in. */
export const WIZARD_COIN: Coin = COINS.USDU;

/** Step 3 — how much the user self-mints. 100 USDU at 6 decimals. */
export const MINT_AMOUNT = '100000000';

/** Step 4 — the first send. 0.5 USDU. Small enough to feel free, big enough to be real. */
export const FIRST_SEND_AMOUNT = '500000';

/** Step 4 — who the first transfer goes to. Overridable so you can point at your own bot. */
export const WELCOME_BOT =
  import.meta.env.VITE_WELCOME_BOT ?? '@welcome';

/** Issuer backend base URL. Proxied through Vite in dev. */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

/** sessionStorage key for popup-mode session resume. */
export const SESSION_KEY = 'onboard.sphere.session';

/** localStorage key for the theme choice. */
export const THEME_KEY = 'onboard.theme';

/** Nametag rules, mirrored from the wallet so we can validate before the hand-off. */
export const NAMETAG_RE = /^[a-z0-9_]{3,20}$/;
