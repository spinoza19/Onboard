/**
 * Connect error -> what the human should read, and what the dApp is allowed to do next.
 *
 * The only rule that really matters: `retry` is FALSE for 4201. When the outcome
 * is unknown the money may already have moved, so we must never render a button
 * that re-issues the same intent. Everything else in this file is copywriting.
 */

import { ERROR_CODES } from '@unicitylabs/sphere-sdk/connect';

export type Severity = 'info' | 'warn' | 'bad';

export interface FriendlyError {
  code: number | null;
  title: string;
  detail: string;
  severity: Severity;
  /** Safe to offer the same action again? */
  retry: boolean;
}

const UNKNOWN: FriendlyError = {
  code: null,
  title: 'Something went wrong',
  detail: 'The wallet did not complete the request. Try again in a moment.',
  severity: 'bad',
  retry: true,
};

export function codeOf(e: unknown): number | null {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'number' ? c : null;
}

export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return '';
}

/** True while the wallet is locked — the session is alive, so never tear it down. */
export function isLocked(e: unknown): boolean {
  return codeOf(e) === ERROR_CODES.WALLET_LOCKED;
}

/**
 * The transient mint failure documented in CONNECT.md: the wallet's per-wallet
 * subscription key has not reached the oracle yet. It is a retry, not a failure,
 * and it must not be rendered in red.
 */
export function isMintWarmingUp(e: unknown): boolean {
  return (
    codeOf(e) === ERROR_CODES.INTERNAL_ERROR &&
    /subscription is still being set up/i.test(messageOf(e))
  );
}

export function toFriendly(e: unknown): FriendlyError {
  const code = codeOf(e);
  const msg = messageOf(e);

  if (isMintWarmingUp(e)) {
    return {
      code,
      title: 'Wallet is warming up',
      detail:
        'Your wallet is still registering with the network. This clears itself — retrying in a few seconds.',
      severity: 'info',
      retry: true,
    };
  }

  switch (code) {
    case ERROR_CODES.WALLET_LOCKED:
      return {
        code,
        title: 'Wallet locked',
        detail:
          'Unlock Sphere to continue. You stay connected — nothing is lost and you do not need to reconnect.',
        severity: 'warn',
        retry: true,
      };

    case ERROR_CODES.USER_REJECTED:
    case ERROR_CODES.INTENT_CANCELLED:
      return {
        code,
        title: 'You declined it',
        detail: 'Nothing happened. Whenever you are ready, run the step again.',
        severity: 'info',
        retry: true,
      };

    case ERROR_CODES.INTENT_OUTCOME_UNKNOWN:
      return {
        code,
        title: 'Outcome unknown — do not retry',
        detail:
          'The request reached your wallet but the answer was lost. It may have gone through. Open Sphere and check your history before doing anything else; retrying could pay twice.',
        severity: 'bad',
        retry: false,
      };

    case ERROR_CODES.INSUFFICIENT_BALANCE:
      return {
        code,
        title: 'Not enough balance',
        detail: 'Go back one step and mint yourself some testnet tokens first.',
        severity: 'warn',
        retry: true,
      };

    case ERROR_CODES.INVALID_RECIPIENT:
      return {
        code,
        title: 'Recipient not found',
        detail:
          'That name does not resolve to anyone on this network. Check the spelling, or point the wizard at a different welcome bot.',
        severity: 'warn',
        retry: true,
      };

    case ERROR_CODES.INCOMPATIBLE_NETWORK:
      return {
        code,
        title: 'Wrong network',
        detail: `Your wallet is on a different network than this app (testnet2, id ${4}). Switch networks in Sphere and reload.`,
        severity: 'bad',
        retry: false,
      };

    case ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION:
      return {
        code,
        title: 'Version mismatch',
        detail: msg || 'Your Sphere wallet is too old for this app. Update it and try again.',
        severity: 'bad',
        retry: false,
      };

    case ERROR_CODES.SESSION_EXPIRED:
      return {
        code,
        title: 'Session expired',
        detail: 'Reconnect your wallet to carry on. Your progress is read back from the wallet.',
        severity: 'warn',
        retry: true,
      };

    case ERROR_CODES.PERMISSION_DENIED:
      return {
        code,
        title: 'Permission not granted',
        detail:
          'This step needs a scope your wallet did not approve. Disconnect and reconnect, then approve all listed permissions.',
        severity: 'warn',
        retry: true,
      };

    case ERROR_CODES.RATE_LIMITED:
      return {
        code,
        title: 'Slow down',
        detail: 'Too many requests at once. Wait a couple of seconds.',
        severity: 'warn',
        retry: true,
      };

    case ERROR_CODES.NOT_CONNECTED:
      return {
        code,
        title: 'Not connected',
        detail: 'Connect your Sphere wallet first.',
        severity: 'warn',
        retry: true,
      };

    case ERROR_CODES.TRANSFER_FAILED:
      return {
        code,
        title: 'Transfer failed',
        detail: msg || 'The network refused the transfer. Nothing was spent.',
        severity: 'bad',
        retry: true,
      };

    default:
      return msg ? { ...UNKNOWN, code, detail: msg } : { ...UNKNOWN, code };
  }
}

/**
 * A cold-started, locked wallet refuses the HANDSHAKE with an errorless empty
 * response — a bare "Connection rejected by wallet" carrying NO code. Per the
 * docs that silence is deliberate, and it means "not ready yet", not "no".
 */
export function isNotReadyYet(e: unknown): boolean {
  return codeOf(e) === null && /rejected by wallet/i.test(messageOf(e));
}
