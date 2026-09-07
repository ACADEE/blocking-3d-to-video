import React, { useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import Spinner from './Spinner.jsx';

// Suivi de tache kie.ai.
//
// Deux besoins, un seul composant. D'abord confirmer qu'une soumission a bien
// ete enregistree : entre l'envoi et le premier sondage, rien ne le disait.
// Ensuite reprendre la main sur un identifiant colle — apres une expiration ou
// un onglet ferme, c'etait jusqu'ici une impasse apres un rendu paye.

const STATE_TONE = {
  waiting: 'text-white/70',
  queuing: 'text-white/70',
  generating: 'text-signal',
  success: 'text-ok',
  fail: 'text-alert',
};

function Row({ label, value, tone = 'text-white/90' }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
      <span className="text-white/70">{label}</span>
      <span className={`tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

export default function TaskTracker() {
  const t = useT();
  const ping = useStore((s) => s.taskPing);
  const render = useStore((s) => s.render);
  const checkTask = useStore((s) => s.checkTask);
  const resumeTask = useStore((s) => s.resumeTask);
  const dismiss = useStore((s) => s.dismissTaskPing);
  const [value, setValue] = useState('');

  const busy = ['uploading', 'submitting', 'polling'].includes(render.status);
  const state = ping?.state || null;
  // Un etat non documente ne doit pas s'afficher brut : on le nomme, ou on dit
  // qu'on ne sait pas.
  const stateLabel = state ? t(`task.state.${state}`) : t('task.state.unknown');

  const submit = (e) => {
    e.preventDefault();
    if (value.trim()) checkTask(value);
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-ink-600 pb-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/70">
          {t('task.title')}
        </h2>
        {ping && (
          <button
            type="button"
            onClick={dismiss}
            className="-my-1 py-1 font-mono text-[11px] text-white/70 transition-colors hover:text-white"
          >
            {t('action.close')}
          </button>
        )}
      </div>

      {ping?.accepted && (
        <div className="mb-3 rounded border border-ok/35 bg-ok/10 p-3">
          <p className="mb-1.5 flex items-center gap-2 text-[12px] leading-relaxed text-ok">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
              <path d="M9.6 16.2 4.8 11.4l1.4-1.4 3.4 3.4 8-8 1.4 1.4z" />
            </svg>
            {t('task.accepted')}
          </p>
          <div className="space-y-0.5">
            <Row label={t('task.state')} value={stateLabel} tone={STATE_TONE[state] || 'text-white/90'} />
            <Row
              label={t('task.progress')}
              value={ping.progress != null ? `${ping.progress} %` : null}
            />
            <Row label={t('task.credits')} value={ping.credits != null ? ping.credits : null} />
            <Row label={t('task.model')} value={ping.model} />
            <Row
              label={t('task.created')}
              value={ping.createTime ? new Date(ping.createTime).toLocaleTimeString() : null}
            />
            <Row label="taskId" value={ping.taskId} />
          </div>

          {!busy && state && !['success', 'fail'].includes(state) && (
            <button
              type="button"
              onClick={() => resumeTask(ping.taskId)}
              className="btn-ghost mt-2.5 w-full"
            >
              {t('task.resume')}
            </button>
          )}
        </div>
      )}

      <form onSubmit={submit}>
        <label htmlFor="task-id" className="label-micro mb-1">
          {t('task.check')}
        </label>
        <div className="flex gap-2">
          <input
            id="task-id"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('task.placeholder')}
            className="field min-w-0 flex-1 font-mono text-[11px]"
          />
          <button type="submit" disabled={!value.trim() || ping?.checking} className="btn-ghost">
            {ping?.checking && <Spinner />}
            {ping?.checking ? t('task.checking') : t('task.check')}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/70">{t('task.checkHint')}</p>

        {ping?.error && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-alert">
            {ping.error === 'render.block.key' ? t('render.block.key') : ping.error}
          </p>
        )}
      </form>
    </section>
  );
}
