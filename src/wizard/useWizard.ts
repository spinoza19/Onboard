/**
 * The wizard state machine.
 *
 * The one design rule: THE WALLET IS THE SOURCE OF TRUTH. Nothing is marked done
 * because we remember doing it — every step re-derives its own completion from a
 * wallet query. That is what makes a mid-wizard refresh, an address switch, or a
 * lock/unlock cycle land the user exactly where they actually are instead of
 * where our local state thought they were.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSphere } from '@/sphere/useSphere';
import { WIZARD_COIN } from '@/lib/config';
import { issuer, BackendOffline, type IssuerInfo } from '@/lib/api';

export type StepId = 'connect' | 'nametag' | 'mint' | 'send' | 'badge';

export const STEPS: ReadonlyArray<{ id: StepId; title: string; hint: string }> = [
  { id: 'connect', title: 'Connect', hint: 'Attach your Sphere wallet' },
  { id: 'nametag', title: 'Claim a name', hint: 'Become @someone' },
  { id: 'mint', title: 'Get funded', hint: 'Self-mint 100 USDU' },
  { id: 'send', title: 'First transfer', hint: 'Say hello, on-chain' },
  { id: 'badge', title: 'Collect badge', hint: 'Issued to you, not by you' },
];

export interface WalletFacts {
  balanceBase: string;
  tokenCount: number;
  sentCount: number;
  receivedCount: number;
  hasBadge: boolean;
  badgeTokenId?: string;
}

const EMPTY: WalletFacts = {
  balanceBase: '0',
  tokenCount: 0,
  sentCount: 0,
  receivedCount: 0,
  hasBadge: false,
};

interface AssetRow {
  coinId?: string;
  totalAmount?: string;
  confirmedAmount?: string;
  tokenCount?: number;
}

interface HistoryRow {
  type?: string;
  coinId?: string;
}

interface TokenRow {
  coinId?: string;
  id?: string;
  tokenId?: string;
}

/** Base-unit strings come off the wire; a malformed one must not crash a render. */
function asBig(v: string | undefined): bigint {
  try {
    return BigInt(v || '0');
  } catch {
    return 0n;
  }
}

/** `sphere_getHistory` answers a flat array on the legacy wire; tolerate both shapes. */
function asRows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  const entries = (value as { entries?: unknown } | null)?.entries;
  return Array.isArray(entries) ? (entries as T[]) : [];
}

export function useWizard() {
  const sphere = useSphere();
  const { status, locked, identity, revision, query } = sphere;

  const [facts, setFacts] = useState<WalletFacts>(EMPTY);
  const [info, setInfo] = useState<IssuerInfo | null>(null);
  const [issuerOffline, setIssuerOffline] = useState(false);
  const [reading, setReading] = useState(false);
  const [manualStep, setManualStep] = useState<StepId | null>(null);

  const inFlight = useRef(false);

  // Issuer metadata: who the welcome bot is, and which type id the badge uses.
  useEffect(() => {
    let cancelled = false;
    issuer
      .info()
      .then((i) => {
        if (!cancelled) {
          setInfo(i);
          setIssuerOffline(false);
        }
      })
      .catch((e) => {
        if (!cancelled) setIssuerOffline(e instanceof BackendOffline);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Re-read every fact the steps depend on. Deliberately skipped while locked:
   * nothing is served from cache behind a lock, so polling would only collect
   * 4009s — and a dApp holding a stale balance is about to offer an unpayable spend.
   */
  const readWallet = useCallback(async () => {
    if (status !== 'connected' || locked || inFlight.current) return;
    inFlight.current = true;
    setReading(true);
    try {
      const [assetsRaw, historyRaw, tokensRaw] = await Promise.all([
        query<unknown>('sphere_getAssets').catch(() => []),
        query<unknown>('sphere_getHistory').catch(() => []),
        query<unknown>('sphere_getTokens').catch(() => []),
      ]);

      const assets = asRows<AssetRow>(assetsRaw);
      const history = asRows<HistoryRow>(historyRaw);
      const tokens = asRows<TokenRow>(tokensRaw);

      const mine = assets.find((a) => a.coinId?.toLowerCase() === WIZARD_COIN.id);
      const badge = info?.badgeCoinId
        ? tokens.find((t) => t.coinId?.toLowerCase() === info.badgeCoinId.toLowerCase())
        : undefined;

      setFacts({
        balanceBase: mine?.confirmedAmount ?? mine?.totalAmount ?? '0',
        tokenCount: mine?.tokenCount ?? 0,
        sentCount: history.filter((h) => h.type === 'SENT').length,
        receivedCount: history.filter((h) => h.type === 'RECEIVED').length,
        hasBadge: Boolean(badge),
        badgeTokenId: badge?.tokenId ?? badge?.id,
      });
    } finally {
      inFlight.current = false;
      setReading(false);
    }
  }, [status, locked, query, info]);

  // Re-verify whenever the wallet says anything changed.
  useEffect(() => {
    void readWallet();
  }, [readWallet, revision]);

  const done = useMemo<Record<StepId, boolean>>(() => {
    const connected = status === 'connected';
    return {
      connect: connected,
      nametag: connected && Boolean(identity?.nametag),
      mint: connected && asBig(facts.balanceBase) > 0n,
      send: connected && facts.sentCount > 0,
      badge: connected && facts.hasBadge,
    };
  }, [status, identity, facts]);

  const completed = STEPS.filter((s) => done[s.id]).length;
  const percent = Math.round((completed / STEPS.length) * 100);

  /** First unfinished step — where the user actually is. */
  const suggested = useMemo<StepId>(
    () => STEPS.find((s) => !done[s.id])?.id ?? 'badge',
    [done],
  );

  // A manual selection is only honoured while it stays reachable; once the user
  // completes the step they jumped to, we hand navigation back to the machine.
  const active: StepId = manualStep && !done[manualStep] ? manualStep : suggested;

  const goTo = useCallback(
    (id: StepId) => {
      const idx = STEPS.findIndex((s) => s.id === id);
      const firstOpen = STEPS.findIndex((s) => !done[s.id]);
      // Never let someone skip ahead past work that has not happened.
      if (firstOpen !== -1 && idx > firstOpen) return;
      setManualStep(id);
    },
    [done],
  );

  return {
    sphere,
    steps: STEPS,
    active,
    done,
    facts,
    info,
    issuerOffline,
    reading,
    percent,
    completed,
    allDone: completed === STEPS.length,
    goTo,
    refresh: readWallet,
  };
}

export type Wizard = ReturnType<typeof useWizard>;
