/** Small presentational pieces shared by the steps. */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Spark } from './Icons';

/* ---------------------------------------------------------------- marquee -- */

export function Marquee({
  items,
  quiet = false,
}: {
  items: string[];
  quiet?: boolean;
}) {
  // Two identical groups + a -50% translate = a seamless loop at any width.
  const group = (
    <div className="marquee__group" aria-hidden>
      {items.map((t, i) => (
        <span key={i}>
          {t} <i>✦</i>
        </span>
      ))}
    </div>
  );

  return (
    <div className={quiet ? 'marquee marquee--quiet' : 'marquee'}>
      <div className="marquee__track">
        {group}
        {group}
      </div>
      <span className="sr-only">{items.join(' · ')}</span>
    </div>
  );
}

/* --------------------------------------------------------------- confetti -- */

const CONFETTI_COLORS = ['#ff6f00', '#ff2d6f', '#ffa800', '#8b5cf6', '#00b578'];

export function Confetti({ fire }: { fire: boolean }) {
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    if (fire) setBurst((b) => b + 1);
  }, [fire]);

  const pieces = useMemo(() => {
    if (!burst) return [];
    return Array.from({ length: 90 }, (_, i) => ({
      key: `${burst}-${i}`,
      left: Math.random() * 100,
      delay: Math.random() * 0.9,
      duration: 2.4 + Math.random() * 2,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      round: i % 3 === 0,
    }));
  }, [burst]);

  if (!pieces.length) return null;

  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p) => (
        <i
          key={p.key}
          style={{
            left: `${p.left}%`,
            background: p.color,
            borderRadius: p.round ? '50%' : '2px',
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- note -- */

export function Note({
  tone = 'info',
  icon,
  children,
}: {
  tone?: 'info' | 'warn' | 'bad' | 'ok';
  icon?: string;
  children: ReactNode;
}) {
  const cls = tone === 'info' ? 'note' : `note note--${tone}`;
  const glyph = icon ?? (tone === 'ok' ? '✓' : tone === 'bad' ? '!' : tone === 'warn' ? '!' : 'i');
  return (
    <div className={cls} role={tone === 'bad' ? 'alert' : undefined}>
      <span className="note__i">{glyph}</span>
      <div>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------- stat -- */

export function Stat({ k, v, unit }: { k: string; v: ReactNode; unit?: string }) {
  return (
    <div className="stat">
      <div className="stat__k">{k}</div>
      <div className="stat__v">
        {v}
        {unit ? <small>{unit}</small> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- badge art -- */

/**
 * The completion badge, drawn rather than fetched — an artifact must be
 * self-contained and a remote image is one more thing that can 404.
 */
export function BadgeArt({ earned, label = 'ONBOARDED' }: { earned: boolean; label?: string }) {
  return (
    <div className={earned ? 'badge-art' : 'badge-art badge-art--ghost'}>
      <svg width="190" height="190" viewBox="0 0 200 200" aria-hidden>
        <defs>
          <linearGradient id="badge-face" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ff2d6f" />
            <stop offset="52%" stopColor="#ff6f00" />
            <stop offset="100%" stopColor="#ffa800" />
          </linearGradient>
          <path id="badge-arc" d="M100 168a68 68 0 0 1 0-136 68 68 0 0 1 0 136" fill="none" />
        </defs>

        {/* 12-point rosette, the Maxima blob idiom in radial form */}
        <g>
          {Array.from({ length: 12 }, (_, i) => (
            <circle
              key={i}
              cx={100 + 74 * Math.cos((i / 12) * Math.PI * 2)}
              cy={100 + 74 * Math.sin((i / 12) * Math.PI * 2)}
              r="17"
              fill="url(#badge-face)"
            />
          ))}
        </g>
        <circle cx="100" cy="100" r="78" fill="url(#badge-face)" />
        <circle cx="100" cy="100" r="62" fill="var(--surface)" />

        <text
          fontFamily="Anton, sans-serif"
          fontSize="11"
          letterSpacing="3.4"
          fill="var(--ink-3)"
        >
          <textPath href="#badge-arc" startOffset="50%" textAnchor="middle">
            UNICITY · TESTNET2 ·
          </textPath>
        </text>

        <text
          x="100"
          y="94"
          textAnchor="middle"
          fontFamily="Anton, sans-serif"
          fontSize="27"
          fill="var(--ink)"
        >
          {label}
        </text>
        <text
          x="100"
          y="116"
          textAnchor="middle"
          fontFamily="Geist Mono, monospace"
          fontSize="9.5"
          letterSpacing="2.6"
          fill="var(--brand)"
        >
          NO. 001
        </text>
      </svg>
      {earned ? (
        <Spark
          size={26}
          style={{ position: 'absolute', top: 4, right: 2, color: 'var(--brand-warm)' }}
        />
      ) : null}
    </div>
  );
}
