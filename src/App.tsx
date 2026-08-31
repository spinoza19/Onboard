import { useEffect, useState } from 'react';

import { useSphere } from '@/sphere/useSphere';
import { useWizard, type StepId } from '@/wizard/useWizard';
import { useTheme } from '@/ui/useTheme';
import { Confetti, Marquee, Note } from '@/ui/bits';
import { Check, Moon, Sun, UMark } from '@/ui/Icons';
import { displayName } from '@/lib/format';
import { NETWORK, WALLET_URL } from '@/lib/config';

import { Step1Connect } from '@/wizard/steps/Step1Connect';
import { Step2Nametag } from '@/wizard/steps/Step2Nametag';
import { Step3Mint } from '@/wizard/steps/Step3Mint';
import { Step4Send } from '@/wizard/steps/Step4Send';
import { Step5Badge } from '@/wizard/steps/Step5Badge';

const TICKER = [
  'SELF-CUSTODY BY DEFAULT',
  'KEYS NEVER LEAVE THE WALLET',
  'PEER-TO-PEER SETTLEMENT',
  'NO GAS AUCTION',
  'TESTNET2',
  'FIVE STEPS · THREE MINUTES',
];

function Header() {
  const { theme, toggle } = useTheme();
  const { status, identity, locked } = useSphere();

  return (
    <header className="hdr">
      <a className="hdr__mark" href="#top">
        <span className="hdr__glyph" style={{ color: 'var(--on-brand)' }}>
          <UMark size={17} />
        </span>
        <span className="hdr__word">
          ON<span>BOARD</span>
        </span>
      </a>

      <span className="hdr__net">
        <b>●</b> {NETWORK.name ?? 'testnet2'} · id {NETWORK.id}
      </span>

      {status === 'connected' ? (
        <span className="chip" title={identity?.chainPubkey}>
          <span className={locked ? 'chip__dot chip__dot--locked' : 'chip__dot'} />
          <span className="chip__name">{locked ? 'locked' : displayName(identity)}</span>
        </span>
      ) : null}

      <button
        className="icon-btn"
        onClick={toggle}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <Sun /> : <Moon />}
      </button>
    </header>
  );
}

function Hero({ onStart, connected }: { onStart: () => void; connected: boolean }) {
  return (
    <section className="hero" id="top">
      <span className="kicker">Unicity · Sphere Connect</span>
      <h1 className="hero__title">
        <span className="em">Empty</span> wallet
        <br />
        <span className="grad">to somebody</span>
      </h1>
      <p className="hero__sub">
        A name, funds, a first transfer and a badge that somebody else issued you. Five steps,
        every one of them real on testnet2, every one of them confirmed inside your own wallet.
      </p>
      <div className="hero__cta">
        <button className="btn" onClick={onStart}>
          {connected ? 'Continue' : 'Start onboarding'}
        </button>
        <a className="btn btn--ghost" href={WALLET_URL} target="_blank" rel="noreferrer noopener">
          Get Sphere
        </a>
      </div>
      <p className="hero__note">No account · No email · No custody</p>
    </section>
  );
}

function Rail({
  steps,
  active,
  done,
  percent,
  goTo,
}: {
  steps: ReadonlyArray<{ id: StepId; title: string; hint: string }>;
  active: StepId;
  done: Record<StepId, boolean>;
  percent: number;
  goTo: (id: StepId) => void;
}) {
  const firstOpen = steps.findIndex((s) => !done[s.id]);

  return (
    <nav className="rail" aria-label="Onboarding progress">
      <div className="rail__head">
        <span className="rail__pct">{percent}</span>
        <span className="rail__label">
          percent
          <br />
          complete
        </span>
      </div>
      <div
        className="rail__bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="rail__fill" style={{ width: `${percent}%` }} />
      </div>

      {steps.map((s, i) => {
        const isDone = done[s.id];
        const isActive = s.id === active;
        const reachable = firstOpen === -1 || i <= firstOpen;
        return (
          <button
            key={s.id}
            className={[
              'step-btn',
              isActive ? 'step-btn--active' : '',
              isDone ? 'step-btn--done' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => goTo(s.id)}
            disabled={!reachable}
            aria-current={isActive ? 'step' : undefined}
          >
            <span className="step-btn__num">{isDone ? <Check size={14} /> : i + 1}</span>
            <span className="step-btn__txt">
              <span className="step-btn__title">{s.title}</span>
              <span className="step-btn__hint">{s.hint}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function Toasts() {
  const { events, dismissEvent } = useSphere();
  if (!events.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {events.map((e) => (
        <div key={e.id} className="toast">
          <div style={{ flex: 1 }}>
            <div className="toast__k">{e.kind}</div>
            <div className="toast__t">{e.text}</div>
          </div>
          <button
            className="icon-btn"
            style={{ width: 26, height: 26, borderRadius: 8 }}
            onClick={() => dismissEvent(e.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const w = useWizard();
  const { sphere, steps, active, done, percent, allDone, goTo } = w;
  const [celebrated, setCelebrated] = useState(false);

  useEffect(() => {
    if (allDone) setCelebrated(true);
  }, [allDone]);

  const start = () => {
    document.getElementById('wizard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (sphere.status === 'idle') void sphere.connect();
  };

  // Hold the layout still while a silent reconnect decides, so the Connect
  // button never flashes on a reload of an already-approved origin.
  const booting = sphere.status === 'booting' && sphere.willAutoConnect;

  return (
    <>
      <div className="backdrop" aria-hidden />
      <div className="shell">
        <Header />
        <Hero onStart={start} connected={sphere.status === 'connected'} />
        <Marquee items={TICKER} />

        <main className="wiz" id="wizard">
          <Rail steps={steps} active={active} done={done} percent={percent} goTo={goTo} />

          <div>
            {booting ? (
              <section className="card">
                <div className="card__eyebrow">Reconnecting</div>
                <h2 className="card__title">Looking for your wallet</h2>
                <p className="card__body">
                  This origin was approved before, so we are restoring the session without
                  bothering you for another approval.
                </p>
              </section>
            ) : (
              <>
                {active === 'connect' && <Step1Connect w={w} />}
                {active === 'nametag' && <Step2Nametag w={w} />}
                {active === 'mint' && <Step3Mint w={w} />}
                {active === 'send' && <Step4Send w={w} />}
                {active === 'badge' && <Step5Badge w={w} />}
              </>
            )}

            {sphere.locked ? (
              <Note tone="warn">
                <strong>Wallet locked — you are still connected.</strong> A lock is not a
                disconnect: the session stays alive and your progress is intact. Unlock Sphere
                and this page picks up exactly where it was.
              </Note>
            ) : null}

            {allDone ? (
              <section className="card card--done" style={{ marginTop: 22 }}>
                <div className="card__eyebrow">Done</div>
                <h2 className="card__title">
                  {sphere.identity?.nametag ? `@${sphere.identity.nametag}` : 'You'} exist on
                  Unicity
                </h2>
                <p className="card__body">
                  Named, funded, transacted, badged. Everything you just did lives in your
                  wallet and travels with you to the next app — this one holds nothing of
                  yours.
                </p>
              </section>
            ) : null}
          </div>
        </main>

        <Marquee items={TICKER.slice().reverse()} quiet />

        <footer className="ftr">
          <span>ONBOARD · a Sphere Connect reference dApp</span>
          <span className="ftr__spacer" />
          <span>Network {NETWORK.name ?? 'testnet2'} · id {NETWORK.id}</span>
          <span>Connect {sphere.walletProtocol ?? '2.1'}</span>
        </footer>
      </div>

      <Toasts />
      <Confetti fire={celebrated} />
    </>
  );
}
