/**
 * ONBOARD issuer — the half of the wizard that cannot live in the browser.
 *
 * Two jobs, one wallet:
 *
 *   1. THE WELCOME BOT. Watches for incoming transfers, replies with a DM and
 *      sends a little back, so step 4 shows the user real money arriving.
 *
 *   2. THE BADGE ISSUER. A badge the user mints for themselves proves nothing —
 *      the `mint` intent is a SELF-mint and anyone could make a million. So the
 *      user signs a challenge, we recover their pubkey from the signature, and
 *      we mint the badge from THIS wallet and send it to them. Provenance then
 *      checks out against our published pubkey.
 *
 * Note the provider wiring: `createNodeProviders` alone has no money rail, and
 * `Sphere.init` refuses it with INVALID_CONFIG. The wallet-api transport config
 * from `createWalletApiProviders` is what makes payments exist at all.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import 'dotenv/config';
import express from 'express';
import { Sphere, verifySignedMessage } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { createWalletApiProviders } from '@unicitylabs/sphere-sdk/impl/shared/wallet-api';

/* ------------------------------------------------------------------ config -- */

const PORT = Number(process.env.PORT ?? 8788);
const DATA_DIR = process.env.DATA_DIR ?? './wallet-data';
const LEDGER_PATH = resolve(process.env.LEDGER_PATH ?? './wallet-data/badges.json');

const NETWORK = 'testnet2';
const WALLET_API = process.env.WALLET_API_URL ?? 'https://wallet-api.unicity.network';
/** Documented as public, not a secret. Override in your own deployment. */
const GATEWAY_KEY = process.env.GATEWAY_API_KEY ?? 'sk_ddc3cfcc001e4a28ac3fad7407f99590';

const BOT_NAMETAG = process.env.BOT_NAMETAG ?? 'welcome';

/** USDU — what the wizard is denominated in. */
const USDU = '8f0f3d7a5e7297be0ee98c63b81bcebb2740f43f616566fc290f9823a54f52d7';

/**
 * The badge's coin id. A distinct id minted at quantity 1 — its meaning comes
 * from WHO issued it, not from a non-fungible flag. Swap in a non-fungible type
 * id here if your deployment prefers one.
 */
const BADGE_COIN_ID =
  process.env.BADGE_COIN_ID ??
  '0b0a4d0e0b0a4d0e0b0a4d0e0b0a4d0e0b0a4d0e0b0a4d0e0b0a4d0e0b0a4d0e';

/** What the bot sends back so step 4 shows a live incoming transfer. */
const REPLY_AMOUNT = process.env.REPLY_AMOUNT ?? '1000000'; // 1 USDU

/** Signatures older than this are refused, so a leaked one cannot be replayed forever. */
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ ledger -- */

interface BadgeRecord {
  tokenId?: string;
  nametag?: string;
  issuedAt: string;
}

type Ledger = Record<string, BadgeRecord>;

function loadLedger(): Ledger {
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Ledger;
  } catch {
    return {};
  }
}

function saveLedger(l: Ledger): void {
  mkdirSync(dirname(LEDGER_PATH), { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(l, null, 2));
}

const ledger = loadLedger();

/* ------------------------------------------------------------------ wallet -- */

async function boot() {
  const base = createNodeProviders({
    network: 'testnet',
    dataDir: DATA_DIR,
    oracle: { apiKey: GATEWAY_KEY },
  });

  // REQUIRED. Without this there is no money rail and Sphere.init throws INVALID_CONFIG.
  const providers = createWalletApiProviders(base, {
    baseUrl: WALLET_API,
    network: NETWORK,
    deviceId: process.env.DEVICE_ID ?? 'onboard-issuer',
  });

  const walletExisted = existsSync(resolve(DATA_DIR, 'wallet.json'));

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    network: NETWORK, // must equal walletApi.network or init throws INVALID_CONFIG
    mnemonic: process.env.MNEMONIC || undefined,
    autoGenerate: !process.env.MNEMONIC,
    nametag: walletExisted ? undefined : BOT_NAMETAG,
  });

  if (created && generatedMnemonic) {
    console.log('\n' + '='.repeat(72));
    console.log('  A NEW ISSUER WALLET WAS CREATED. SAVE THIS MNEMONIC NOW:');
    console.log('  ' + generatedMnemonic);
    console.log('  Put it in server/.env as MNEMONIC= to reuse this identity.');
    console.log('='.repeat(72) + '\n');
  }

  return sphere;
}

/* -------------------------------------------------------------- welcome bot -- */

/** Who the listener has already answered — lets /api/welcome report the truth. */
const welcomed = new Set<string>();

function wireWelcomeBot(sphere: any): void {
  sphere.on('transfer:incoming', async (t: any) => {
    const peer: string | undefined = t?.senderNametag
      ? `@${t.senderNametag}`
      : t?.senderPubkey;
    if (!peer) return;
    if (t?.senderPubkey) welcomed.add(t.senderPubkey);

    console.log(`[bot] incoming from ${peer}`);

    try {
      await sphere.communications?.sendDM(
        peer,
        'Welcome to Unicity. That transfer was peer-to-peer — no gas auction, no pending block, ' +
          'and the tokens were in your own custody the whole time. Here is a little back.',
      );
    } catch (e) {
      console.warn('[bot] DM failed:', (e as Error).message);
    }

    try {
      await sphere.payments.send({
        recipient: peer,
        amount: REPLY_AMOUNT,
        coinId: USDU,
        memo: 'welcome back',
      });
      console.log(`[bot] replied to ${peer}`);
    } catch (e) {
      console.warn('[bot] reply transfer failed:', (e as Error).message);
    }
  });
}

/* ------------------------------------------------------------------- server -- */

async function main() {
  console.log('[issuer] booting wallet…');
  const sphere = await boot();

  const issuerPubkey: string = sphere.identity?.chainPubkey ?? '';
  const nametag: string = sphere.identity?.nametag ?? BOT_NAMETAG;

  console.log(`[issuer] identity  @${nametag}`);
  console.log(`[issuer] pubkey    ${issuerPubkey}`);

  wireWelcomeBot(sphere);

  const app = express();
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/info', (_req, res) => {
    res.json({
      welcomeBot: `@${nametag}`,
      issuerPubkey,
      badgeCoinId: BADGE_COIN_ID,
    });
  });

  /**
   * Wire-compatible with the serverless issuer so the frontend behaves the same
   * against either. Here the listener does the actual replying, so this only
   * reports whether it has already fired for that address.
   */
  app.post('/api/welcome', (req, res) => {
    const pubkey = String(req.body?.chainPubkey ?? '');
    if (!pubkey) return res.status(400).json({ error: 'chainPubkey is required' });
    if (welcomed.has(pubkey)) return res.json({ status: 'already-welcomed' });
    return res.status(202).json({ status: 'no-transfer-yet' });
  });

  app.get('/api/badge/status', (req, res) => {
    const pubkey = String(req.query.pubkey ?? '');
    const rec = ledger[pubkey];
    if (!rec) return res.json({ status: 'pending' });
    res.json({ status: 'already-issued', tokenId: rec.tokenId, issuedAt: rec.issuedAt });
  });

  app.post('/api/badge/claim', async (req, res) => {
    const { chainPubkey, nametag: userTag, message, signature } = req.body ?? {};

    if (!chainPubkey || !message || !signature) {
      return res.status(400).json({ error: 'chainPubkey, message and signature are required' });
    }

    // 1. The signature must be for THIS pubkey. verifySignedMessage recovers the
    //    key from the signature, so a forged claim for someone else's address fails.
    let ok = false;
    try {
      ok = verifySignedMessage(message, signature, chainPubkey);
    } catch {
      ok = false;
    }
    if (!ok) return res.status(401).json({ error: 'Signature does not match that address' });

    // 2. The challenge must be fresh and must name this address, so an old
    //    signature captured elsewhere cannot be replayed.
    if (!String(message).includes(chainPubkey)) {
      return res.status(400).json({ error: 'Challenge does not name the claiming address' });
    }
    const issuedAt = /Issued At: (.+)/.exec(String(message))?.[1];
    const age = issuedAt ? Date.now() - Date.parse(issuedAt) : NaN;
    if (!Number.isFinite(age) || age < -60_000 || age > CHALLENGE_TTL_MS) {
      return res.status(400).json({ error: 'Challenge expired — reload and sign a fresh one' });
    }

    // 3. One badge per address. This is the whole anti-farming story.
    const existing = ledger[chainPubkey];
    if (existing) {
      return res.json({
        status: 'already-issued',
        tokenId: existing.tokenId,
        issuedAt: existing.issuedAt,
      });
    }

    try {
      const minted = await sphere.payments.mint(BADGE_COIN_ID, 1n);
      if (!minted?.success) throw new Error(minted?.error ?? 'mint refused');

      const sent = await sphere.payments.send({
        recipient: userTag ? `@${userTag}` : chainPubkey,
        amount: '1',
        coinId: BADGE_COIN_ID,
        memo: 'ONBOARD completion badge',
      });

      ledger[chainPubkey] = {
        tokenId: minted.tokenId,
        nametag: userTag,
        issuedAt: new Date().toISOString(),
      };
      saveLedger(ledger);

      console.log(`[issuer] badge -> ${userTag ? '@' + userTag : chainPubkey}`);

      // deliveryPending means the spend is committed and delivery is still
      // retrying — the badge is on its way, so 'pending' is the honest answer.
      res.json({
        status: sent?.deliveryState === 'pending-delivery' ? 'pending' : 'issued',
        tokenId: minted.tokenId,
        issuedAt: ledger[chainPubkey].issuedAt,
      });
    } catch (e) {
      console.error('[issuer] badge issue failed:', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.listen(PORT, () => console.log(`[issuer] listening on http://localhost:${PORT}`));

  const shutdown = async () => {
    console.log('\n[issuer] shutting down…');
    try {
      await sphere.destroy();
    } catch {
      /* nothing left to close */
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[issuer] fatal:', e);
  process.exit(1);
});
