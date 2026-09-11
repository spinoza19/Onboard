/**
 * Upstash Redis over HTTP — the durable store, since a serverless filesystem is
 * ephemeral and a TCP connection pool is the wrong shape for functions.
 *
 * Also the distributed lock. Every wallet-mutating request holds it for its whole
 * duration, because two concurrent invocations both loading and re-saving the same
 * wallet blob is a lost update that eats a payment journal.
 */

import { Redis } from '@upstash/redis';
import { KEY } from './config.js';

let client: Redis | null = null;

export function redis(): Redis {
  if (client) return client;

  // Vercel's Upstash integration injects KV_*; a hand-rolled setup uses UPSTASH_*.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      'No Redis configured. Add the Upstash integration (Storage → Marketplace) or set ' +
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
    );
  }

  client = new Redis({ url, token });
  return client;
}

/**
 * Release only if we still own it. A plain DEL would let a request whose lock had
 * already expired delete the NEXT holder's lock, which is the exact failure the
 * lock exists to prevent.
 */
const RELEASE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export interface LockHandle {
  release: () => Promise<void>;
}

/**
 * Acquire the wallet lock, or throw.
 *
 * `ttlMs` must exceed the longest operation we run under it; the TTL exists only
 * so a crashed invocation cannot wedge the wallet forever.
 */
export async function lock(
  { ttlMs = 55_000, waitMs = 8_000 } = {},
): Promise<LockHandle> {
  const r = redis();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + waitMs;

  for (;;) {
    const got = await r.set(KEY.lock, token, { nx: true, px: ttlMs });
    if (got === 'OK') {
      return {
        release: async () => {
          try {
            await r.eval(RELEASE, [KEY.lock], [token]);
          } catch {
            /* the TTL will clear it; failing to release must not fail the request */
          }
        },
      };
    }
    if (Date.now() >= deadline) {
      throw Object.assign(
        new Error('The issuer is busy with another request. Try again in a moment.'),
        { status: 503 },
      );
    }
    await new Promise((res) => setTimeout(res, 250));
  }
}
