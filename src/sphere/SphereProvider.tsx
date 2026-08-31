/**
 * The wallet adapter.
 *
 * One React context owning the entire Sphere Connect lifecycle, so no screen in
 * the app ever touches a ConnectClient directly. The four things it gets right,
 * which are the four things dApps usually get wrong:
 *
 *  1. LOCK IS NOT DISCONNECT. `wallet:locked` keeps the session alive. We flip a
 *     flag and stop querying; we never tear down and never re-handshake.
 *  2. IDENTITY CAN CHANGE UNDER YOU. A legal address switch mid-session means the
 *     nametag, balance and history you cached belong to somebody else. We compare
 *     chainPubkey on every unlock and reset when it moves.
 *  3. A COLD-STARTED LOCKED WALLET REFUSES THE HANDSHAKE WITH SILENCE — no error
 *     code at all. That is "not ready yet", not "no", so we keep waiting instead
 *     of showing a permanent failure.
 *  4. 4201 IS NOT RETRYABLE. Surfaced through toFriendly(), never swallowed.
 */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  autoConnect,
  detectTransport,
  hasExtension,
  type AutoConnectResult,
  type DetectedTransport,
} from '@unicitylabs/sphere-sdk/connect/browser';

// The `connect` and `connect/browser` entry points each ship their OWN declaration
// of ConnectClient, and TypeScript treats the two as unrelated (private members).
// Deriving from AutoConnectResult pins us to the one autoConnect actually returns.
type ConnectClient = AutoConnectResult['client'];
export type PublicIdentity = AutoConnectResult['connection']['identity'];

import { DAPP, NETWORK, SCOPES, SESSION_KEY, WALLET_URL } from '@/lib/config';
import { isNotReadyYet, toFriendly, type FriendlyError } from '@/lib/errors';

export type SphereStatus =
  | 'booting' // deciding whether a silent reconnect is worth attempting
  | 'idle' // no wallet attached; show the Connect button
  | 'connecting' // handshake in flight (approval modal may be open)
  | 'waiting' // wallet is there but cold-started locked: waiting for a human
  | 'connected'
  | 'error';

export interface WalletEventLog {
  id: number;
  kind: string;
  text: string;
}

export interface SphereContextValue {
  status: SphereStatus;
  /** True between wallet:locked and wallet:unlocked. The session is still valid. */
  locked: boolean;
  identity: PublicIdentity | null;
  transport: DetectedTransport | null;
  /** Wallet's Connect protocol version — only trustworthy after a good handshake. */
  walletProtocol: string | null;
  error: FriendlyError | null;
  /** Used to render a loading state instead of a Connect-button flash on reload. */
  willAutoConnect: boolean;
  /** Bumps whenever the wallet says something changed; steps re-verify on it. */
  revision: number;
  events: WalletEventLog[];

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Read from the wallet. Throws the raw error; call sites map it. */
  query: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  /** Ask the wallet to do something. Opens the wallet's own confirmation UI. */
  intent: <T>(action: string, params: Record<string, unknown>) => Promise<T>;
  /** Re-read identity from the wallet (used after the nametag hand-off). */
  refreshIdentity: () => Promise<PublicIdentity | null>;
  dismissEvent: (id: number) => void;
  clearError: () => void;
}

export const SphereContext = createContext<SphereContextValue | null>(null);

let eventSeq = 0;

export function SphereProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SphereStatus>('booting');
  const [locked, setLocked] = useState(false);
  const [identity, setIdentity] = useState<PublicIdentity | null>(null);
  const [transport, setTransport] = useState<DetectedTransport | null>(null);
  const [walletProtocol, setWalletProtocol] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [willAutoConnect, setWillAutoConnect] = useState(true);
  const [revision, setRevision] = useState(0);
  const [events, setEvents] = useState<WalletEventLog[]>([]);

  const sessionRef = useRef<AutoConnectResult | null>(null);
  const clientRef = useRef<ConnectClient | null>(null);
  /** The pubkey we handshook with. An unlock that reports a different one is a new user. */
  const boundPubkey = useRef<string | null>(null);
  const unsubs = useRef<Array<() => void>>([]);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const pushEvent = useCallback((kind: string, text: string) => {
    const id = ++eventSeq;
    setEvents((prev) => [...prev.slice(-3), { id, kind, text }]);
    setTimeout(() => {
      setEvents((prev) => prev.filter((e) => e.id !== id));
    }, 9000);
  }, []);

  const dismissEvent = useCallback((id: number) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const teardown = useCallback(() => {
    unsubs.current.forEach((u) => {
      try {
        u();
      } catch {
        /* the transport may already be gone; nothing to salvage */
      }
    });
    unsubs.current = [];
    clientRef.current = null;
    sessionRef.current = null;
    boundPubkey.current = null;
    setIdentity(null);
    setLocked(false);
    setWalletProtocol(null);
    sessionStorage.removeItem(SESSION_KEY);
  }, []);

  /** Wire the wallet's push events. All four wallet:* events arrive unsubscribed. */
  const attachEvents = useCallback(
    (client: ConnectClient) => {
      const add = (name: string, fn: (data: unknown) => void) => {
        unsubs.current.push(client.on(name, fn));
      };

      add('wallet:locked', () => {
        setLocked(true);
        pushEvent('wallet', 'Wallet locked. Unlock Sphere to carry on — you stay connected.');
      });

      add('wallet:unlocked', (data) => {
        const next = (data as { identity?: PublicIdentity } | undefined)?.identity ?? null;
        setLocked(false);
        // A different seed behind the same approved origin is a different person.
        if (next?.chainPubkey && boundPubkey.current && next.chainPubkey !== boundPubkey.current) {
          boundPubkey.current = next.chainPubkey;
          setIdentity(next);
          pushEvent('identity', 'A different address is active. Progress re-read from scratch.');
        } else if (next) {
          setIdentity(next);
        }
        setRevision((r) => r + 1);
        pushEvent('wallet', 'Wallet unlocked.');
      });

      add('wallet:disconnected', () => {
        teardown();
        setStatus('idle');
        pushEvent('wallet', 'Wallet disconnected.');
      });

      add('identity:changed', (data) => {
        const next = (data as { identity?: PublicIdentity } | undefined)?.identity ?? null;
        if (next) {
          boundPubkey.current = next.chainPubkey;
          setIdentity(next);
        }
        setRevision((r) => r + 1);
        pushEvent('identity', 'Active address changed.');
      });

      // These three need an explicit subscribe (events:subscribe scope).
      add('transfer:incoming', () => {
        setRevision((r) => r + 1);
        pushEvent('money', 'Incoming transfer landed in your wallet.');
      });
      add('transfer:confirmed', () => {
        setRevision((r) => r + 1);
        pushEvent('money', 'Transfer confirmed on the network.');
      });
      add('transfer:failed', () => {
        setRevision((r) => r + 1);
        pushEvent('money', 'A transfer failed.');
      });

      for (const ev of ['transfer:incoming', 'transfer:confirmed', 'transfer:failed']) {
        client.query('sphere_subscribe', { event: ev }).catch(() => {
          /* subscribe is best-effort: the wizard still works on polling */
        });
      }
    },
    [pushEvent, teardown],
  );

  const open = useCallback(
    async (silent: boolean) => {
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      setError(null);
      setStatus(silent ? 'booting' : 'connecting');

      try {
        const result = await autoConnect({
          dapp: DAPP,
          walletUrl: WALLET_URL,
          network: NETWORK,
          permissions: SCOPES,
          silent,
          resumeSessionId: sessionStorage.getItem(SESSION_KEY) ?? undefined,
        });
        if (!alive.current) {
          void result.disconnect();
          return;
        }

        sessionRef.current = result;
        clientRef.current = result.client;
        boundPubkey.current = result.connection.identity.chainPubkey;

        sessionStorage.setItem(SESSION_KEY, result.connection.sessionId);
        setIdentity(result.connection.identity);
        setTransport(result.transport);
        setWalletProtocol(result.client.walletProtocol);
        // A resume that lands during a lock is connected — it just has to wait.
        setLocked(Boolean(result.connection.locked));
        setStatus('connected');
        setRevision((r) => r + 1);
        attachEvents(result.client);
      } catch (e) {
        if (!alive.current) return;
        sessionStorage.removeItem(SESSION_KEY);

        // Cold-started locked wallet: an errorless refusal. Keep waiting.
        if (isNotReadyYet(e)) {
          setStatus(silent ? 'idle' : 'waiting');
          if (!silent) {
            retryTimer.current = setTimeout(() => void open(true), 4000);
          }
          return;
        }

        if (silent) {
          // Nothing approved this origin yet — that is the normal cold path.
          setStatus('idle');
          return;
        }

        setError(toFriendly(e));
        setStatus('error');
      }
    },
    [attachEvents],
  );

  // Boot: only attempt a silent reconnect when one can plausibly succeed, and
  // hold the UI in 'booting' while we decide so the Connect button never flashes.
  useEffect(() => {
    alive.current = true;
    const plausible = Boolean(sessionStorage.getItem(SESSION_KEY)) || hasExtension();
    setWillAutoConnect(plausible);
    setTransport(detectTransport());

    if (plausible) {
      void open(true);
    } else {
      setStatus('idle');
    }

    return () => {
      alive.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      unsubs.current.forEach((u) => {
        try {
          u();
        } catch {
          /* transport already torn down */
        }
      });
      unsubs.current = [];
    };
  }, [open]);

  const connect = useCallback(() => open(false), [open]);

  const disconnect = useCallback(async () => {
    const s = sessionRef.current;
    teardown();
    setStatus('idle');
    if (s) {
      try {
        await s.disconnect();
      } catch {
        /* already gone */
      }
    }
  }, [teardown]);

  const query = useCallback(async <T,>(method: string, params?: Record<string, unknown>) => {
    const c = clientRef.current;
    if (!c) throw Object.assign(new Error('Not connected'), { code: 4001 });
    return c.query<T>(method, params);
  }, []);

  const intent = useCallback(async <T,>(action: string, params: Record<string, unknown>) => {
    const c = clientRef.current;
    if (!c) throw Object.assign(new Error('Not connected'), { code: 4001 });
    return c.intent<T>(action, params);
  }, []);

  const refreshIdentity = useCallback(async () => {
    try {
      // sphere_getIdentity answers even while locked, from an immutable snapshot.
      const next = await query<PublicIdentity>('sphere_getIdentity');
      if (next) {
        setIdentity(next);
        boundPubkey.current = next.chainPubkey;
      }
      return next ?? null;
    } catch {
      return null;
    }
  }, [query]);

  const value = useMemo<SphereContextValue>(
    () => ({
      status,
      locked,
      identity,
      transport,
      walletProtocol,
      error,
      willAutoConnect,
      revision,
      events,
      connect,
      disconnect,
      query,
      intent,
      refreshIdentity,
      dismissEvent,
      clearError: () => setError(null),
    }),
    [
      status,
      locked,
      identity,
      transport,
      walletProtocol,
      error,
      willAutoConnect,
      revision,
      events,
      connect,
      disconnect,
      query,
      intent,
      refreshIdentity,
      dismissEvent,
    ],
  );

  return <SphereContext.Provider value={value}>{children}</SphereContext.Provider>;
}
