import type { ReactNode } from 'react';

export function StepShell({
  index,
  eyebrow,
  title,
  done,
  children,
  actions,
}: {
  index: number;
  eyebrow: string;
  title: ReactNode;
  done?: boolean;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={done ? 'card card--done' : 'card'} aria-labelledby={`step-${index}`}>
      <div className="card__idx">{String(index).padStart(2, '0')}</div>
      <div className="card__eyebrow">{eyebrow}</div>
      <h2 className="card__title" id={`step-${index}`}>
        {title}
      </h2>
      {children}
      {actions ? <div className="card__actions">{actions}</div> : null}
    </section>
  );
}
