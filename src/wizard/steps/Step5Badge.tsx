/**
 * Step 5 — the badge.
 *
 * Deliberately NOT a self-mint. The `mint` intent produces fungible tokens that the
 * user mints to themselves, so a self-minted "badge" proves nothing — anyone could
 * make a million. A badge only carries meaning when the ISSUER mints it and sends
 * it, because then its provenance is checkable against the issuer's pubkey.
 *
 * So: the user signs a challenge with `sign_message` (proving they hold the key),
 * the backend verifies the signature, mints the badge from its own wallet and
 * sends it over. It arrives as a normal `transfer:incoming`.
 */

import { useCallback, useState } from 'react';
import { StepShell } from './StepShell';
import { BadgeArt, Note, Stat } from '@/ui/bits';
import { Arrow, Refresh } from '@/ui/Icons';
import { shortHex } from '@/lib/format';
import { issuer, BackendOffline } from '@/lib/api';
import { toFriendly, type FriendlyError } from '@/lib/errors';
import type { Wizard } from '../useWizard';

export function Step5Badge({ w }: { w: Wizard }) {
  const { sphere, done, facts, info, issuerOffline, refresh } = w;
  const { intent, identity, locked } = sphere;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FriendlyError | null>(null);
  const [pending, setPending] = useState(false);

  const claim = useCallback(async () => {
    if (!identity?.chainPubkey) return;
    setBusy(true);
    setErr(null);
    try {
      // A domain-bound, timestamped challenge. The issuer re-derives it and
      // recovers the pubkey from the signature — no key material involved.
      const message = [
        'Claim the ONBOARD completion badge.',
        '',
        `Domain: ${location.host}`,
        `Address: ${identity.chainPubkey}`,
        `Issued At: ${new Date().toISOString()}`,
      ].join('\n');

      const signed = await intent<{ signature: string; publicKey: string }>('sign_message', {
        message,
      });

      const res = await issuer.claimBadge({
        chainPubkey: identity.chainPubkey,
        nametag: identity.nametag,
        message,
        signature: signed.signature,
      });

      setPending(res.status === 'pending');
      await refresh();
    } catch (e) {
      if (e instanceof BackendOffline) {
        setErr({
          code: null,
          title: 'Issuer is not running',
          detail:
            'The badge is minted by a backend wallet, not by yours. Start the issuer in server/ and this step completes on its own.',
          severity: 'warn',
          retry: true,
        });
      } else {
        setErr(toFriendly(e));
      }
    } finally {
      setBusy(false);
    }
  }, [identity, intent, refresh]);

  if (done.badge) {
    return (
      <StepShell index={5} eyebrow="Step 05 — Proof" title="Badge collected" done>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
          <BadgeArt earned />
          <div style={{ flex: '1 1 260px' }}>
            <p className="card__body">
              That token sits in your wallet, minted by the ONBOARD issuer and signed over to
              your address. Its meaning comes from <em>who</em> issued it — anyone can check the
              provenance against the issuer pubkey below. That is the whole difference between a
              badge and a sticker.
            </p>
            <div className="stat-grid">
              <Stat k="Holder" v={identity?.nametag ? `@${identity.nametag}` : shortHex(identity?.chainPubkey)} />
              {facts.badgeTokenId ? <Stat k="Token id" v={shortHex(facts.badgeTokenId, 8, 6)} /> : null}
              {info?.issuerPubkey ? <Stat k="Issued by" v={shortHex(info.issuerPubkey, 8, 6)} /> : null}
            </div>
          </div>
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      index={5}
      eyebrow="Step 05 — Proof"
      title="Collect your badge"
      actions={
        <>
          <button className="btn" onClick={() => void claim()} disabled={busy || locked || issuerOffline}>
            {busy ? <span className="spinner" /> : null}
            {busy ? 'Signing' : 'Sign and claim'}
            {busy ? null : <Arrow />}
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => void refresh()}>
            <Refresh /> Check my wallet
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
        <BadgeArt earned={false} />
        <div style={{ flex: '1 1 260px' }}>
          <p className="card__body">
            You will sign a short message to prove you hold the key for this address. Signing
            costs nothing and moves nothing — the private key never leaves Sphere, and the
            issuer recovers your public key from the signature alone.
          </p>
          <p className="card__body">
            Then the issuer mints the badge from <em>its</em> wallet and sends it to you. It
            lands as an ordinary incoming transfer.
          </p>
        </div>
      </div>

      {issuerOffline ? (
        <Note tone="warn">
          <strong>Issuer offline.</strong> Steps 1–4 are pure wallet-to-network work and need
          nothing from us, but the badge genuinely cannot be self-minted — see{' '}
          <code>server/README.md</code> to start it.
        </Note>
      ) : null}

      {pending ? (
        <Note tone="info" icon="…">
          Signature accepted. The issuer is minting and sending — it will appear here as an
          incoming transfer within a few seconds.
        </Note>
      ) : null}

      {locked ? <Note tone="warn">Unlock Sphere to sign.</Note> : null}

      {err ? (
        <Note tone={err.severity === 'info' ? 'info' : err.severity}>
          <strong>{err.title}.</strong> {err.detail}
          {err.code ? <div className="mono-break">Connect error {err.code}</div> : null}
        </Note>
      ) : null}
    </StepShell>
  );
}
