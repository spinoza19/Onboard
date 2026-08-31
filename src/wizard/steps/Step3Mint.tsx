/**
 * Step 3 — self-mint.
 *
 * `mint` is the v2 replacement for the testnet faucet: the wallet mints to itself,
 * always behind a confirmation. Two things this step is careful about:
 *
 *  - amount is BASE UNITS as a string (100 USDU at 6 decimals = '100000000'), and
 *    coinId is the canonical lowercase 64-hex id. A symbol like 'USDU' is rejected.
 *  - "Subscription is still being set up" is a TRANSIENT INTERNAL_ERROR, not a
 *    failure. We auto-retry it and never paint it red.
 */

import { useCallback, useRef, useState } from 'react';
import { StepShell } from './StepShell';
import { Note, Stat } from '@/ui/bits';
import { Arrow } from '@/ui/Icons';
import { MINT_AMOUNT, WIZARD_COIN } from '@/lib/config';
import { fromBaseUnits, shortHex } from '@/lib/format';
import { isMintWarmingUp, toFriendly, type FriendlyError } from '@/lib/errors';
import type { Wizard } from '../useWizard';

const MAX_WARMUP_RETRIES = 6;

export function Step3Mint({ w }: { w: Wizard }) {
  const { sphere, done, facts, refresh } = w;
  const { intent, locked } = sphere;

  const [busy, setBusy] = useState(false);
  const [warming, setWarming] = useState(false);
  const [err, setErr] = useState<FriendlyError | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const retries = useRef(0);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await intent<{ tokenId?: string }>('mint', {
        coinId: WIZARD_COIN.id,
        amount: MINT_AMOUNT,
      });
      retries.current = 0;
      setWarming(false);
      setMinted(res?.tokenId ?? null);
      await refresh();
    } catch (e) {
      if (isMintWarmingUp(e) && retries.current < MAX_WARMUP_RETRIES) {
        retries.current += 1;
        setWarming(true);
        setTimeout(() => void run(), 3500);
        return;
      }
      setWarming(false);
      setErr(toFriendly(e));
    } finally {
      setBusy(false);
    }
  }, [intent, refresh]);

  const human = fromBaseUnits(MINT_AMOUNT, WIZARD_COIN.decimals);

  if (done.mint) {
    return (
      <StepShell index={3} eyebrow="Step 03 — Funding" title="You are funded" done>
        <p className="card__body">
          The tokens are yours and they live in your wallet, not in an account we keep for you.
          The network only certified the state transition.
        </p>
        <div className="stat-grid">
          <Stat
            k={`${WIZARD_COIN.symbol} balance`}
            v={fromBaseUnits(facts.balanceBase, WIZARD_COIN.decimals)}
            unit={WIZARD_COIN.symbol}
          />
          <Stat k="Tokens held" v={facts.tokenCount} />
          {minted ? <Stat k="Minted token" v={shortHex(minted, 8, 6)} /> : null}
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      index={3}
      eyebrow="Step 03 — Funding"
      title={`Mint ${human} ${WIZARD_COIN.symbol}`}
      actions={
        <button className="btn" onClick={() => void run()} disabled={busy || locked}>
          {busy || warming ? <span className="spinner" /> : null}
          {warming ? 'Warming up' : busy ? 'Confirm in Sphere' : `Mint ${human} ${WIZARD_COIN.symbol}`}
          {busy || warming ? null : <Arrow />}
        </button>
      }
    >
      <p className="card__body">
        There is no faucet to queue for. On testnet2 your own wallet mints the tokens directly,
        which is why the confirmation appears in Sphere rather than here.
      </p>

      <div className="stat-grid">
        <Stat k="Amount" v={human} unit={WIZARD_COIN.symbol} />
        <Stat k="Base units" v={MINT_AMOUNT} />
        <Stat k="Decimals" v={WIZARD_COIN.decimals} />
        <Stat k="Coin id" v={shortHex(WIZARD_COIN.id, 10, 6)} />
      </div>

      {warming ? (
        <Note tone="info" icon="…">
          Your wallet is still registering its subscription key with the oracle. This clears
          itself — retrying automatically ({retries.current}/{MAX_WARMUP_RETRIES}).
        </Note>
      ) : null}

      {locked ? (
        <Note tone="warn">Unlock Sphere first — minting is refused while the wallet is locked.</Note>
      ) : null}

      {err ? (
        <Note tone={err.severity === 'info' ? 'info' : err.severity}>
          <strong>{err.title}.</strong> {err.detail}
          {err.code ? <div className="mono-break">Connect error {err.code}</div> : null}
        </Note>
      ) : null}
    </StepShell>
  );
}
