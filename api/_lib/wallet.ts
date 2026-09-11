/**
 * Running a stateful wallet inside a stateless function.
 *
 * The SDK's FileStorageProvider keeps the whole wallet in memory and rewrites the
 * entire `wallet.json` on every `set()`. That is the shape of a single blob, not a
 * key-value store — so rather than reimplementing the SDK's key scoping (which
 * spans per-address, per-network and module-composite keys, and would be a silent
 * wrong-key bug if I got it a character wrong), we keep the SDK's own provider and
 * move the blob around it:
 *
 *     hydrate   Redis blob  ->  /tmp/wallet.json
 *     run       Sphere.init, do the work, destroy (which flushes to the file)
 *     flush     /tmp/wallet.json  ->  Redis blob
 *
 * The whole sandwich runs under a Redis lock, because two invocations doing this
 * concurrently is a lost update that would eat a payment journal.
 *
 * /tmp survives container reuse on Vercel, which is a hazard rather than a help:
 * a stale wallet from a previous invocation could outlive fresher state in Redis.
 * So hydrate always OVERWRITES, and removes the file outright when Redis is empty.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { BOT_NAMETAG, GATEWAY_KEY, KEY, NETWORK, WALLET_API_URL, mnemonic } from './config';
import { lock, redis } from './redis';

const DATA_DIR = '/tmp/onboard-issuer';
const WALLET_FILE = join(DATA_DIR, 'wallet.json');

export interface Issuer {
  /** The live Sphere instance, already initialised. */
  sphere: any;
  chainPubkey: string;
  /**
   * The nametag we ACTUALLY hold, or null.
   *
   * Never falls back to the configured BOT_NAMETAG. Nametag bindings are
   * first-seen-wins on Nostr, so a registration that lost the race means the name
   * belongs to somebody else — and publishing it as ours would route every user's
   * first transfer to a stranger's wallet. The pubkey is always ours.
   */
  nametag: string | null;
}

export interface Timings {
  /** ms spent waiting for the lock */
  lock: number;
  /** ms spent in Sphere.init — the number that decides whether this design survives */
  boot: number;
  /** ms spent in the caller's own work */
  work: number;
  total: number;
}

/**
 * The issuer's public identity, without booting a wallet.
 *
 * Populated by the first `withIssuer` call and read from Redis thereafter — the
 * whole point being that a page load costs one Redis GET, not a Sphere.init.
 */
export async function cachedIdentity(): Promise<{
  chainPubkey: string;
  nametag: string | null;
} | null> {
  const raw = await redis().get<string | Record<string, string>>(KEY.identity);
  if (!raw) return null;
  const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return v?.chainPubkey ? (v as { chainPubkey: string; nametag: string | null }) : null;
}

async function hydrate(): Promise<boolean> {
  const blob = await redis().get<string>(KEY.wallet);
  mkdirSync(DATA_DIR, { recursive: true });

  if (typeof blob === 'string' && blob.length > 0) {
    writeFileSync(WALLET_FILE, blob, { mode: 0o600 });
    return true;
  }

  // No wallet in Redis yet. Any file here is a leftover from a reused container
  // and must not be mistaken for our state.
  rmSync(WALLET_FILE, { force: true });
  rmSync(WALLET_FILE + '.tmp', { force: true });
  return false;
}

async function flush(): Promise<void> {
  if (!existsSync(WALLET_FILE)) return;
  const blob = readFileSync(WALLET_FILE, 'utf8');
  if (blob.trim()) await redis().set(KEY.wallet, blob);
}

/**
 * Run `fn` against a booted issuer wallet, holding the lock for the whole thing.
 *
 * Never leaks the lock or the Sphere instance: both are released in `finally`, so
 * a throw inside `fn` cannot wedge the next request.
 */
export async function withIssuer<T>(
  fn: (issuer: Issuer) => Promise<T>,
): Promise<{ result: T; timings: Timings }> {
  const t0 = Date.now();
  const handle = await lock();
  const tLocked = Date.now();

  let sphere: any = null;
  try {
    await hydrate();

    // Imported HERE, not at module scope, for two reasons. It keeps the SDK out of
    // the read-only paths entirely — /api/info on a warm cache never loads it — and
    // it turns a failure to load it into a readable JSON error instead of a bare
    // FUNCTION_INVOCATION_FAILED, which tells you nothing about what went wrong.
    const [{ Sphere }, { createNodeProviders }, { createWalletApiProviders }] =
      await Promise.all([
        import('@unicitylabs/sphere-sdk'),
        import('@unicitylabs/sphere-sdk/impl/nodejs'),
        import('@unicitylabs/sphere-sdk/impl/shared/wallet-api'),
      ]);

    const base = createNodeProviders({
      network: 'testnet',
      dataDir: DATA_DIR,
      oracle: { apiKey: GATEWAY_KEY },
    });

    // REQUIRED: without the wallet-api rail there is no money vertical at all and
    // Sphere.init refuses with INVALID_CONFIG.
    const providers = createWalletApiProviders(base, {
      baseUrl: WALLET_API_URL,
      network: NETWORK,
      deviceId: process.env.DEVICE_ID ?? 'onboard-issuer',
    });

    const init = await Sphere.init({
      ...providers,
      // Must equal walletApi.network, or INVALID_CONFIG again.
      network: NETWORK,
      mnemonic: mnemonic(),
      // Applied only on create; inert once the wallet exists.
      nametag: BOT_NAMETAG,
    });

    sphere = init.sphere;
    const tBooted = Date.now();

    const identity = {
      chainPubkey: sphere.identity?.chainPubkey ?? '',
      nametag: (sphere.identity?.nametag as string | undefined) ?? null,
    };
    // Cache it so /api/info — hit on every page load — never boots a wallet.
    await redis().set(KEY.identity, JSON.stringify(identity));

    const result = await fn({ sphere, ...identity });
    const tWorked = Date.now();

    // destroy() disconnects the storage provider, which writes wallet.json. The
    // flush has to come after it or we would persist a pre-operation snapshot.
    await sphere.destroy();
    sphere = null;
    await flush();

    return {
      result,
      timings: {
        lock: tLocked - t0,
        boot: tBooted - tLocked,
        work: tWorked - tBooted,
        total: Date.now() - t0,
      },
    };
  } finally {
    if (sphere) {
      // The happy path already destroyed and nulled it; reaching here means `fn`
      // threw. Persist anyway — a mint that succeeded before a send failed is
      // real state, and dropping it would mint the same badge twice next time.
      try {
        await sphere.destroy();
        await flush();
      } catch {
        /* nothing left to salvage; the lock release below still has to run */
      }
    }
    await handle.release();
  }
}
