# ONBOARD

A five-step onboarding wizard for the Unicity network, built on **Sphere Connect** (the Sphere
wallet adapter). It takes someone from an empty wallet to a named, funded, transacting,
badge-holding identity — every step real, on `testnet2`, every action confirmed inside the
user's own wallet.

```
connect  →  claim a name  →  self-mint 100 USDU  →  first transfer  →  collect a badge
```

---

## Run it

```bash
npm install && npm run dev
```

Open <http://localhost:5174>. Steps 1–4 work immediately — they are pure wallet↔network work
and need no backend. Step 5 needs the issuer (below), and says so plainly when it is missing.

You need a [Sphere wallet](https://sphere.unicity.network) — the browser extension, or the
hosted wallet (the app falls back to a popup automatically).

### The issuer / welcome bot

```bash
cd server && cp .env.example .env && npm install && npm run dev
```

On first boot it generates a wallet and **prints a mnemonic once**. Paste it into
`server/.env` as `MNEMONIC=` to keep the same identity across restarts. Fund it (via the CLI
or its own self-mint) before it can reply to transfers or issue badges.

---

## Architecture

```
Frontend (Vite + React + TS)          Sphere wallet             Issuer backend (Node)
────────────────────────────          ─────────────             ─────────────────────
useSphere()  ──── Connect ────────►   ConnectHost               wallet + welcome bot
wizard state machine                  user keys never leave     mints + sends the badge
        └──────────────── REST ──────────────────────────────►  SQLite-less JSON ledger
```

| Path | What it is |
|---|---|
| `src/sphere/SphereProvider.tsx` | **The wallet adapter.** Owns the whole Connect lifecycle. |
| `src/wizard/useWizard.ts` | The state machine. Re-derives every step from wallet queries. |
| `src/wizard/steps/*` | The five screens. |
| `src/lib/errors.ts` | Connect error code → human copy → *is a retry safe?* |
| `src/lib/format.ts` | Base-unit ⇄ human conversion. The only place floats are allowed near money. |
| `server/src/index.ts` | Welcome bot + badge issuer. |

### What the wallet adapter gets right

These are the four things dApps usually get wrong, and the reason this repo is worth copying:

1. **A lock is not a disconnect.** `wallet:locked` keeps the session alive. We flip a flag and
   stop querying — we never tear down, never re-handshake, and never poll behind a lock (the
   wallet serves nothing from cache, so polling only collects `4009`s).
2. **Identity can change under you.** A legal address switch means the nametag and balance you
   cached belong to somebody else. Every unlock compares `chainPubkey` against the one we
   handshook with, and resets when it moved.
3. **A cold-started locked wallet refuses the handshake with silence** — an empty response
   carrying *no error code at all*. That is "not ready yet", not "no", so we keep waiting
   instead of showing a permanent failure.
4. **`4201 INTENT_OUTCOME_UNKNOWN` is not retryable.** The money may already have moved. The
   send step hard-disables its own button on that code and offers reconciliation instead.

### What the wizard gets right

**The wallet is the source of truth.** No step is marked done because we remember doing it —
each one re-derives from a query (`sphere_getIdentity`, `sphere_getAssets`, `sphere_getHistory`,
`sphere_getTokens`). Refresh mid-wizard, switch address, lock and unlock: you land exactly where
you actually are.

---

## Two things the obvious design gets wrong

Worth reading before you copy the step list:

**Nametag registration is not a Connect intent.** `registerNametag()` is an SDK method that
lives *inside* the wallet; the six intents on the wire are `send`, `dm`, `payment_request`,
`receive`, `sign_message`, `mint`. So step 2 is a guided **hand-off**: we validate, probe
availability with `sphere_resolve`, deep-link into Sphere, and watch `identity` until the name
appears. That is also the more honest UX — the name belongs to the user's wallet, not to us.

**A self-minted badge proves nothing.** The `mint` intent is a *self*-mint of a *fungible*
token, so a badge the user mints for themselves is worth exactly as many as they care to make.
Step 5 therefore has the user sign a domain-bound, timestamped challenge with `sign_message`;
the issuer recovers their pubkey from the signature, mints the badge from **its own** wallet,
and sends it over. Provenance is checkable against the published issuer pubkey, and the ledger
enforces one badge per address.

---

## Design

Unicity's brand (`#FF6F00`, `#060606`, **Anton** + **Geist Mono**, grid overlay) crossed with
three references: oversized display type and marquee tickers from CRAV, pill geometry and cream
canvas from Maxima, gradient mesh and spark marks from Wero. Full light and dark themes, driven
by CSS custom properties on `:root` / `:root[data-theme='dark']`, following the OS until the
user picks a side.

---

## Reference

| | |
|---|---|
| SDK | `@unicitylabs/sphere-sdk@^0.15.0` |
| Connect protocol | 2.1 (min SDK floor `0.14.1-0`) |
| Network | `testnet2`, id `4` — the only live network |
| Scopes requested | identity, balance, tokens, history, events, resolve, transfer, mint, sign |
| Coins | `USDU` 6dp · `UCT` 18dp (see `src/lib/config.ts` for the 64-hex ids) |

Amounts on the wire are **base units as a string**, always. `coinId` is the canonical lowercase
64-hex id — a symbol like `USDU` is rejected.
