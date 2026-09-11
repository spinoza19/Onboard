# The serverless issuer

Everything runs on Vercel — the page and the issuer, same deployment, same origin.
No Render, no Fly, no VPS, and no CORS to configure.

## Why this exists

Step 5 hands the user a badge. That badge only means anything if **the issuer**
minted it: the `mint` Connect intent is a *self*-mint of a *fungible* token, so a
badge the user mints for themselves is worth exactly as many as they care to make.
Provenance is the whole product, and provenance needs a second wallet.

## The two problems with running a wallet in a function

**1. The filesystem is ephemeral.** The SDK's `FileStorageProvider` keeps the whole
wallet in memory and rewrites `wallet.json` on every `set()` — the shape of a single
blob, not a key-value store. So rather than reimplementing the SDK's key scoping
(per-address, per-network, module composites — a silent wrong-key bug if a single
character is off), `_lib/wallet.ts` keeps the SDK's own provider and moves the blob
around it:

```
hydrate   Redis blob        ->  /tmp/wallet.json
run       Sphere.init, work, destroy (which flushes to the file)
flush     /tmp/wallet.json  ->  Redis blob
```

The whole sandwich runs under a Redis lock, because two invocations doing this at
once is a lost update that eats a payment journal. `/tmp` survives container reuse
on Vercel, which is a hazard rather than a help — so hydrate always **overwrites**,
and deletes the file outright when Redis is empty.

**2. Nothing can listen.** The always-on version subscribed to `transfer:incoming`
and replied when money landed. A function cannot hold that between requests, so the
trigger moved to the page: step 4 calls `POST /api/welcome` right after its send
resolves. Faster when the user stays on the page; nothing catches up if they close
the tab immediately.

## Endpoints

| | Wallet boot? | |
|---|---|---|
| `GET /api/info` | no (cached) | issuer pubkey, bot nametag, badge coin id |
| `GET /api/badge/status?pubkey=…` | no | has this address been issued a badge |
| `POST /api/badge/claim` | yes | verify signature → mint → send → record |
| `POST /api/welcome` | yes | claim the transfer → DM → send a little back |

`/api/info` is hit on every page load, so it must never boot a wallet: the identity
is cached in Redis by the first `withIssuer` call and read back with a single GET.

## Authorisation

**`badge/claim` requires a signature.** `sign_message` proves the caller holds the
key for the address they name; `verifySignedMessage` recovers the pubkey from the
signature, so no key material is involved on our side. The challenge is bound to the
address and expires after 10 minutes — a signature is a bearer token for as long as
we accept it.

**`welcome` deliberately does not.** Asking for a signature there would put a second
wallet popup directly behind the send confirmation, which is the friction the wizard
exists to remove. Instead the **payment is the proof**: the issuer claims the pending
transfer and looks for one that actually came from the caller's address. You cannot
forge that without having sent the money, which is self-limiting in a way a signature
never was.

Both are recorded once per address.

## Setup

1. **Storage → Marketplace → Upstash Redis** in the Vercel dashboard. The
   integration injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
2. **`MNEMONIC`** in the project environment variables. Generate one first (locally,
   with `server/`, or any BIP39 tool). It is the issuer's identity — change it and
   every badge's provenance changes with it. Never commit it.
3. **Fund the issuer.** It mints and sends on every badge and every welcome reply.
   An empty wallet issues nothing.
4. Redeploy.

## The risk that is still open

`Sphere.init` runs on every invocation — trust base, gateway, wallet-api session,
Nostr relay. If that exceeds the function's `maxDuration` (60 s, set in
`vercel.json`), the claim fails. Both writing endpoints return a `timings` object
(`lock` / `boot` / `work` / `total`) and log it, so this is measured in production
rather than guessed at. If `boot` turns out to be the problem, `server/` is the
always-on alternative and needs no rework.

## Local development

`vercel dev` serves the page and these functions together, exactly as production
does. Plain `npm run dev` proxies `/api` to the Express issuer in `server/` instead —
wire-compatible, but a different implementation.
