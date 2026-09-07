import React from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';

// Le rail du pipeline.
//
// Numeroter est ici justifie : la sequence porte l'information. Le produit
// enchaine blocking -> prompt -> rendu, et rien dans l'interface ne le disait.
// Chaque etape annonce son etat reel, derive, et dit pourquoi elle est bloquee
// plutot que de se contenter d'etre grisee.

const CHECK = 'M9.6 16.2 4.8 11.4l1.4-1.4 3.4 3.4 8-8 1.4 1.4z';

function StateMark({ state }) {
  if (state === 'done') {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <path d={CHECK} />
      </svg>
    );
  }
  if (state === 'running') {
    return (
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
      </span>
    );
  }
  if (state === 'blocked') {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 2a6.9 6.9 0 0 1 3.9 1.2L6.2 15.9A7 7 0 0 1 12 5m0 14a6.9 6.9 0 0 1-3.9-1.2l9.7-9.7A7 7 0 0 1 12 19" />
      </svg>
    );
  }
  return null;
}

const TONE = {
  current: 'border-signal/60 bg-signal/15 text-signal',
  done: 'border-ok/35 bg-ok/10 text-ok hover:bg-ok/15',
  running: 'border-signal/50 bg-signal/10 text-signal',
  ready: 'border-ink-500 bg-ink-700 text-white/70 hover:border-ink-400 hover:text-white',
  blocked: 'border-ink-600 bg-ink-800 text-white/55 hover:border-ink-500',
  todo: 'border-ink-600 bg-ink-800 text-white/55',
};

export default function PipelineRail() {
  const t = useT();
  const screen = useStore((s) => s.screen);
  const goTo = useStore((s) => s.goTo);
  const pipeline = useStore((s) => s.pipeline);
  const scene = useStore((s) => s.scene);

  if (!scene) return null;
  const steps = pipeline();

  const hintOf = (step) => {
    if (!step.hint) return null;
    if (step.hint.missing) {
      return t(step.hint.key, { what: step.hint.missing.map((m) => t(m.key, m.vars)).join(', ') });
    }
    return t(step.hint.key, step.hint.vars);
  };

  return (
    <nav aria-label={t('pipeline.nav')} data-testid="pipeline-rail" className="flex min-w-0 items-center">
      <ol className="flex min-w-0 items-center gap-0.5">
        {steps.map((step, i) => {
          const current = screen === step.id;
          const tone = TONE[current ? 'current' : step.state];
          const label = t(step.label);
          const hint = hintOf(step);
          return (
            <li key={step.id} className="flex min-w-0 items-center">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="mx-1 hidden h-px w-4 shrink-0 bg-ink-500 sm:block lg:w-6"
                />
              )}
              <button
                type="button"
                data-testid={`step-${step.id}`}
                onClick={() => goTo(step.id)}
                aria-current={current ? 'step' : undefined}
                // Le libelle visible disparait sous 768px : le nom accessible,
                // lui, doit rester complet a toutes les largeurs.
                aria-label={`${t('pipeline.step', { n: step.n, total: steps.length, label })}${
                  hint ? ` — ${hint}` : ''
                }`}
                title={hint || label}
                className={`flex shrink-0 items-center gap-1.5 rounded border px-2 py-1.5 transition-colors duration-150 lg:px-2.5 ${tone}`}
              >
                <span aria-hidden="true" className="font-mono text-[11px] tabular-nums opacity-70">
                  {step.n}
                </span>
                <span
                  aria-hidden="true"
                  className="hidden font-mono text-[11px] uppercase tracking-[0.14em] md:inline"
                >
                  {label}
                </span>
                <StateMark state={step.state} />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
