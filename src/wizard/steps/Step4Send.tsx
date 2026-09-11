/**
 * Step 4 — the first transfer.
 *
 * The whole point of this step is the two failure modes nobody demos:
 *
 *  - `deliveryPending: true` means the spend is COMMITTED on-chain and only the
 *    recipient-side delivery is still retrying. The money is gone. We say
 *    "sent, may arrive with a delay" and we do NOT offer a retry button.
 *  - `4201 INTENT_OUTCOME_UNKNOWN` means the answer was lost and the outcome is
 *    genuinely unknown. We hard-disable the button and tell the user to reconcile
 *    in Sphere first, because a retry here is how you pay twice.
 */

import { useCallback, useState } from 'react';
import { StepShell } from './StepShell';
import { Note, Stat } from '@/ui/bits';
import { Arrow } from '@/ui/Icons';
import { FIRST_SEND_AMOUNT, WELCOME_BOT, WIZARD_COIN } from '@/lib/config';
import { fromBaseUnits, shortHex } from '@/lib/format';
import { toFriendly, type FriendlyError } from '@/lib/errors';
import { issuer, BackendOffline } from '@/lib/api';
import type { Wizard } from '../useWizard';

/** How many times to re-ask the bot while the transfer is still reaching its mailbox. */
const WELCOME_ATTEMPTS = 4;
const WELCOME_GAP_MS = 4000;

interface SendResult {
  success?: boolean;
  transferId?: string;
  status?: string;
  deliveryPending?: boolean;
}

type BotState = 'idle' | 'asking' | 'replied' | 'silent' | 'offline';

export function Step4Send({ w }: { w: Wizard }) {
  const { sphere, done, facts, info, refresh } = w;
  const { intent, identity, locked } = sphere;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FriendlyError | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [bot, setBot] = useState<BotState>('idle');

  const recipient = info?.welcomeBot ?? WELCOME_BOT;
  const human = fromBaseUnits(FIRST_SEND_AMOUNT, WIZARD_COIN.decimals);

  /**
   * Poke the welcome bot. On a serverless issuer nothing is listening for the
   * transfer, so the page is what tells it to look — and the transfer may still be
   * reaching the bot's mailbox when we first ask, hence the retries.
   *
   * Never fatal: the step is already complete once the send succeeded. A silent
   * bot costs the user a nicety, not their progress.
   */
  const pokeBot = useCallback(async () => {
    if (!identity?.chainPubkey) return;
    setBot('asking');

    for (let attempt = 0; attempt < WELCOME_ATTEMPTS; attempt++) {
      try {
        const res = await issuer.welcome({
          chainPubkey: identity.chainPubkey,
          nametag: identity.nametag,
        });
        if (res.status !== 'no-transfer-yet') {
          setBot('replied');
          await refresh();
          return;
        }
      } catch (e) {
        setBot(e instanceof BackendOffline ? 'offline' : 'silent');
        return;
      }
      await new Promise((r) => setTimeout(r, WELCOME_GAP_MS));
    }
    setBot('silent');
  }, [identity, refresh]);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await intent<SendResult>('send', {
        to: recipient,
        amount: FIRST_SEND_AMOUNT,
        coinId: WIZARD_COIN.id,
        memo: 'first transfer — sent from the ONBOARD wizard',
      });
      setResult(res);
      await refresh();
      void pokeBot();
    } catch (e) {
      setErr(toFriendly(e));
    } finally {
      setBusy(false);
    }
  }, [intent, recipient, refresh, pokeBot]);

  // The only case where re-offering the action would be dangerous.
  const retryForbidden = err ? !err.retry : false;

  if (done.send) {
    return (
      <StepShell index={4} eyebrow="Step 04 — First transfer" title="You moved value" done>
        <p className="card__body">
          That transfer went peer-to-peer. No gas auction, no pending block, no intermediary
          holding the funds — the network certified a state transition and the tokens changed
          hands.
        </p>
        <div className="stat-grid">
          <Stat k="Sent" v={facts.sentCount} unit={facts.sentCount === 1 ? 'transfer' : 'transfers'} />
          <Stat k="Received" v={facts.receivedCount} />
          <Stat
            k="Balance"
            v={fromBaseUnits(facts.balanceBase, WIZARD_COIN.decimals)}
            unit={WIZARD_COIN.symbol}
          />
          {result?.transferId ? <Stat k="Transfer id" v={shortHex(result.transferId, 8, 6)} /> : null}
        </div>
        {result?.deliveryPending ? (
          <Note tone="warn">
            The spend is committed on-chain but delivery to {recipient} is still retrying in the
            background. Nothing to do — and nothing to re-send.
          </Note>
        ) : null}

        {bot === 'asking' ? (
          <Note tone="info" icon="…">
            Nudging {recipient}. It claims your transfer, then answers with a direct message and
            sends a little back — watch for the live <code>transfer:incoming</code>.
          </Note>
        ) : null}

        {bot === 'replied' ? (
          <Note tone="ok">
            {recipient} answered. Check your DMs in Sphere, and look at your balance — a little
            came back.
          </Note>
        ) : null}

        {bot === 'silent' || bot === 'offline' ? (
          <Note tone="info">
            <strong>Your transfer went through</strong> — this step is done either way. The
            welcome bot just did not answer
            {bot === 'offline' ? ' (the issuer is not reachable)' : ' yet'}.
            <div style={{ marginTop: 10 }}>
              <button className="btn btn--ghost btn--sm" onClick={() => void pokeBot()}>
                Nudge it again
              </button>
            </div>
          </Note>
        ) : null}
      </StepShell>
    );
  }

  return (
    <StepShell
      index={4}
      eyebrow="Step 04 — First transfer"
      title={`Send ${human} to ${recipient}`}
      actions={
        <button
          className="btn"
          onClick={() => void run()}
          disabled={busy || locked || retryForbidden}
        >
          {busy ? <span className="spinner" /> : null}
          {busy ? 'Confirm in Sphere' : `Send ${human} ${WIZARD_COIN.symbol}`}
          {busy ? null : <Arrow />}
        </button>
      }
    >
      <p className="card__body">
        Time to actually use the thing. You are sending {human} {WIZARD_COIN.symbol} to{' '}
        <strong>{recipient}</strong>, a bot that replies with a direct message and sends a little
        back so you can watch money arrive in real time.
      </p>

      <div className="stat-grid">
        <Stat k="To" v={recipient} />
        <Stat k="Amount" v={human} unit={WIZARD_COIN.symbol} />
        <Stat k="Base units" v={FIRST_SEND_AMOUNT} />
        <Stat
          k="Your balance"
          v={fromBaseUnits(facts.balanceBase, WIZARD_COIN.decimals)}
          unit={WIZARD_COIN.symbol}
        />
      </div>

      {locked ? <Note tone="warn">Unlock Sphere to send.</Note> : null}

      {retryForbidden ? (
        <Note tone="bad">
          <strong>{err?.title}.</strong> {err?.detail}
          <div className="mono-break">Connect error {err?.code}</div>
          <div style={{ marginTop: 10 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => void refresh()}>
              Re-read my history
            </button>
          </div>
        </Note>
      ) : err ? (
        <Note tone={err.severity === 'info' ? 'info' : err.severity}>
          <strong>{err.title}.</strong> {err.detail}
          {err.code ? <div className="mono-break">Connect error {err.code}</div> : null}
        </Note>
      ) : null}
    </StepShell>
  );
}
