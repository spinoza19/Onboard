# ONBOARD issuer

The half of the wizard that cannot live in a browser. One wallet, two jobs.

## 1. The welcome bot

Watches `transfer:incoming`. When someone completes step 4, it replies with a NIP-17 direct
message and sends a little back — so the user sees real money arrive as a live event rather
than a success toast we made up.

## 2. The badge issuer

`POST /api/badge/claim` takes a `sign_message` signature, recovers the signer's pubkey with
`verifySignedMessage`, checks the challenge is fresh and names that address, then mints the
badge from **this** wallet and sends it to the user. One badge per address, recorded in
`wallet-data/badges.json`.

A badge the user mints for themselves would prove nothing — that is the whole reason this
service exists.

## Run

```bash
cp .env.example .env
npm install
npm run dev
```

First boot generates a wallet and **prints its mnemonic once**. Put it in `.env` as
`MNEMONIC=` or you get a new identity (and a new issuer pubkey) on every restart.

Then fund it — it pays out on every welcome reply and every badge:

```bash
npx @unicity-sphere/cli topup 100 USDU
```

Requires Node 22.18+ (TypeScript is stripped at runtime, no build step).

## The wiring that trips everyone up

```ts
const base      = createNodeProviders({ network: 'testnet', dataDir, oracle: { apiKey } });
const providers = createWalletApiProviders(base, { baseUrl, network: 'testnet2', deviceId });
```

`createNodeProviders` alone has **no money rail** — `Sphere.init` refuses it with
`INVALID_CONFIG`. And `Sphere.init({ network })` must equal `walletApi.network`, or the same
error. Deposits made before the rail is composed stay claimable in the mailbox.

## Endpoints

| | |
|---|---|
| `GET /api/info` | welcome-bot nametag, issuer pubkey, badge coin id |
| `GET /api/badge/status?pubkey=…` | has this address been issued a badge |
| `POST /api/badge/claim` | `{ chainPubkey, nametag?, message, signature }` → mints and sends |

## Config

See `.env.example`. Notable: `BADGE_COIN_ID` is a distinct 64-hex id minted at quantity 1 — the
badge's meaning comes from *who issued it*, not from a non-fungible flag. Swap in a
non-fungible type id if your deployment prefers one.

The `GATEWAY_API_KEY` default is the testnet2 key, which the SDK docs publish openly. A mainnet
key would be a real secret — keep that one in your deploy environment only.
