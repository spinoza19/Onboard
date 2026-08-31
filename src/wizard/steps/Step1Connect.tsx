import { hasExtension } from '@unicitylabs/sphere-sdk/connect/browser';
import { StepShell } from './StepShell';
import { Note, Stat } from '@/ui/bits';
import { Arrow, External } from '@/ui/Icons';
import { shortHex } from '@/lib/format';
import { WALLET_URL, SCOPES } from '@/lib/config';
import type { Wizard } from '../useWizard';

export function Step1Connect({ w }: { w: Wizard }) {
  const { sphere, done } = w;
  const { status, identity, transport, walletProtocol, error, clearError } = sphere;

  const connecting = status === 'connecting' || status === 'booting';
  const noWallet = !hasExtension() && status === 'idle';

  return (
    <StepShell
      index={1}
      eyebrow="Step 01 — Handshake"
      title={done.connect ? 'Wallet attached' : 'Attach your wallet'}
      done={done.connect}
      actions={
        done.connect ? (
          <>
            <span className="tag tag--ok">✓ Connected over {transport}</span>
            <button className="btn btn--ghost btn--sm" onClick={() => void sphere.disconnect()}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => void sphere.connect()} disabled={connecting}>
              {connecting ? <span className="spinner" /> : null}
              {connecting ? 'Waiting for wallet' : 'Connect Sphere'}
              {connecting ? null : <Arrow />}
            </button>
            {noWallet ? (
              <a
                className="btn btn--ghost"
                href={WALLET_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                Get Sphere <External />
              </a>
            ) : null}
          </>
        )
      }
    >
      <p className="card__body">
        Sphere holds your keys and never hands them over. This app asks it questions and
        proposes actions; every single one of them is something you approve inside the wallet
        itself. Nothing here can move a token on its own.
      </p>

      {!done.connect ? (
        <p className="card__body">
          We are requesting {SCOPES.length} permission scopes — identity, balances, tokens,
          history, events, name resolution, transfers, minting and message signing. That is
          exactly what the five steps need, and nothing beyond it.
        </p>
      ) : null}

      {done.connect ? (
        <div className="stat-grid">
          <Stat k="Identity" v={identity?.nametag ? `@${identity.nametag}` : 'unnamed'} />
          <Stat k="Chain pubkey" v={shortHex(identity?.chainPubkey, 8, 6)} />
          <Stat k="Transport" v={transport ?? '—'} />
          <Stat k="Connect protocol" v={walletProtocol ?? '—'} />
        </div>
      ) : null}

      {status === 'waiting' ? (
        <Note tone="warn">
          Your wallet is there but locked from a cold start, so it refuses the handshake
          without saying why — that silence is deliberate, and it means <em>not yet</em> rather
          than <em>no</em>. Unlock Sphere; we keep retrying in the background.
        </Note>
      ) : null}

      {error ? (
        <Note tone={error.severity === 'info' ? 'info' : error.severity}>
          <strong>{error.title}.</strong> {error.detail}
          {error.code ? <div className="mono-break">Connect error {error.code}</div> : null}
          <div style={{ marginTop: 10 }}>
            <button className="btn btn--ghost btn--sm" onClick={clearError}>
              Dismiss
            </button>
          </div>
        </Note>
      ) : null}
    </StepShell>
  );
}
