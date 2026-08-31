/**
 * Step 2 — the nametag.
 *
 * There is NO Connect intent for registration: `registerNametag()` is an SDK method
 * that lives inside the wallet, and the six intents on the wire are send / dm /
 * payment_request / receive / sign_message / mint. So this step is a guided
 * HAND-OFF, not an in-app action — we validate, check availability, open Sphere,
 * and then watch `sphere_getIdentity` until the name appears.
 *
 * That is also the honest UX: the name belongs to the user's wallet, not to us.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { StepShell } from './StepShell';
import { Note, Stat } from '@/ui/bits';
import { External, Refresh } from '@/ui/Icons';
import { NAMETAG_RE, WALLET_URL } from '@/lib/config';
import { toFriendly } from '@/lib/errors';
import type { Wizard } from '../useWizard';

type Availability = 'unknown' | 'checking' | 'free' | 'taken' | 'failed';

export function Step2Nametag({ w }: { w: Wizard }) {
  const { sphere, done } = w;
  const { identity, query, refreshIdentity, locked } = sphere;

  const [name, setName] = useState('');
  const [avail, setAvail] = useState<Availability>('unknown');
  const [handedOff, setHandedOff] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const valid = NAMETAG_RE.test(name);

  const check = useCallback(async () => {
    if (!valid) return;
    setAvail('checking');
    setProblem(null);
    try {
      // No availability RPC exists. `sphere_resolve` is the closest signal: if it
      // resolves to somebody, the binding is taken.
      const hit = await query<unknown>('sphere_resolve', { identifier: `@${name}` });
      setAvail(hit ? 'taken' : 'free');
    } catch (e) {
      const f = toFriendly(e);
      // A resolve that finds nothing usually throws rather than returning null.
      if (f.code === 4101 || /not (found|resolvable)/i.test(f.detail)) setAvail('free');
      else {
        setAvail('failed');
        setProblem(f.detail);
      }
    }
  }, [name, query, valid]);

  /** Open the wallet's own nametag screen, then poll identity until it lands. */
  const handOff = useCallback(() => {
    setHandedOff(true);
    window.open(
      `${WALLET_URL}/settings/nametag?suggest=${encodeURIComponent(name)}`,
      'sphere-nametag',
      'width=430,height=740',
    );
  }, [name]);

  // Poll while we are waiting on the hand-off. `identity:changed` is the primary
  // signal; this is the belt-and-braces path for wallets that do not emit it.
  useEffect(() => {
    if (!handedOff || done.nametag || locked) return;
    pollRef.current = setInterval(() => void refreshIdentity(), 3000);
    const onFocus = () => void refreshIdentity();
    window.addEventListener('focus', onFocus);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      window.removeEventListener('focus', onFocus);
    };
  }, [handedOff, done.nametag, locked, refreshIdentity]);

  if (done.nametag) {
    return (
      <StepShell index={2} eyebrow="Step 02 — Unicity ID" title="You have a name" done>
        <p className="card__body">
          People can now pay you at <strong>@{identity?.nametag}</strong> instead of a
          sixty-six-character public key. The binding lives on Nostr and points at your chain
          pubkey — it travels with your wallet, not with this app.
        </p>
        <div className="stat-grid">
          <Stat k="Unicity ID" v={`@${identity?.nametag}`} />
          <Stat k="Bound to" v="your chain pubkey" />
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      index={2}
      eyebrow="Step 02 — Unicity ID"
      title="Claim a name"
      actions={
        <>
          <button className="btn" onClick={handOff} disabled={!valid}>
            Register in Sphere <External />
          </button>
          <button className="btn btn--ghost" onClick={() => void check()} disabled={!valid}>
            {avail === 'checking' ? <span className="spinner" /> : null} Check availability
          </button>
          {handedOff ? (
            <button className="btn btn--ghost btn--sm" onClick={() => void refreshIdentity()}>
              <Refresh /> I registered it
            </button>
          ) : null}
        </>
      }
    >
      <p className="card__body">
        A Unicity ID turns your address into something a human can type. Pick one below —
        lowercase letters, digits and underscores, 3 to 20 characters.
      </p>

      <div className="field" style={{ marginTop: 22 }}>
        <span className="field__at">@</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
            setAvail('unknown');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) void check();
          }}
          placeholder="smitek"
          maxLength={20}
          spellCheck={false}
          autoComplete="off"
          aria-label="Choose a Unicity ID"
        />
        <span className="tag" style={{ marginRight: 6 }}>
          {name.length}/20
        </span>
      </div>

      {name && !valid ? (
        <Note tone="warn">
          Lowercase letters, digits and underscores only, and at least three characters.
        </Note>
      ) : null}

      {avail === 'free' ? (
        <Note tone="ok">
          <strong>@{name}</strong> looks free. Registration happens inside your wallet — press
          the button and Sphere will take it from here.
        </Note>
      ) : null}

      {avail === 'taken' ? (
        <Note tone="warn">
          <strong>@{name}</strong> already resolves to someone. Pick another one.
        </Note>
      ) : null}

      {avail === 'failed' ? <Note tone="bad">{problem}</Note> : null}

      {handedOff ? (
        <Note tone="info" icon="…">
          Waiting for Sphere. Finish the registration in the wallet window and come back — this
          page is watching your identity and will move on by itself.
        </Note>
      ) : null}

      <Note tone="info">
        <strong>Why we cannot do this for you.</strong> Sphere Connect exposes six intents and
        registration is not one of them — names are a wallet-level concern, so the wallet owns
        the flow. The availability check is also a best guess: bindings are first-seen-wins on
        Nostr, so two people can race for the same name in the same second.
      </Note>
    </StepShell>
  );
}
