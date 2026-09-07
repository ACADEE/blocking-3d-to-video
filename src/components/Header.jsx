import React from 'react';
import { useStore } from '../store/useStore.js';
import { useT, LANGUAGES } from '../i18n/index.js';
import PipelineRail from './PipelineRail.jsx';
import ExportMenu from './ExportMenu.jsx';

// Header.
//
// Il portait 1136 px de contenu incompressible dans un conteneur non defilable :
// sous 1136 px il amputait ses propres commandes, et sous 700 px les boutons des
// etapes 2 et 3 devenaient incliquables. Tout ce qui n'est pas la navigation du
// pipeline se replie donc par paliers, et la bascule de vue est partie rejoindre
// le viewport, dont elle relevait de toute facon.

const STATUS = {
  idle: { color: 'bg-white/40', key: 'header.status.idle' },
  testing: { color: 'bg-amber-400 animate-pulse', key: 'header.status.testing' },
  ok: { color: 'bg-ok', key: 'header.status.ok' },
  error: { color: 'bg-alert', key: 'header.status.error' },
};

export default function Header() {
  const t = useT();
  const scene = useStore((s) => s.scene);
  const solve = useStore((s) => s.solve);
  const screen = useStore((s) => s.screen);
  const goTo = useStore((s) => s.goTo);
  const apiStatus = useStore((s) => s.apiStatus);
  const apiMessage = useStore((s) => s.apiMessage);
  const creditsSpent = useStore((s) => s.creditsSpent);
  const dirty = useStore((s) => s.dirty);
  const clips = useStore((s) => s.clips);
  const render = useStore((s) => s.render);
  const patchScene = useStore((s) => s.patchScene);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);

  if (!scene) return null;
  const status = STATUS[apiStatus] || STATUS.idle;
  const rendering = ['uploading', 'submitting', 'polling'].includes(render.status);

  const handleHome = () => {
    // Le garde-fou doit nommer tout ce qui va disparaitre, pas seulement la scene.
    const losses = [];
    if (dirty) losses.push(t('header.leave.dirty'));
    if (Object.keys(clips).length) losses.push(t('header.leave.clips'));
    if (rendering) losses.push(t('header.leave.render'));
    if (losses.length && !window.confirm(t('header.leave.confirm', { what: losses.join(', ') }))) return;
    goTo('home');
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-600 bg-ink-800 px-2 lg:gap-3 lg:px-3">
      <button
        type="button"
        onClick={handleHome}
        title={t('header.home.title')}
        aria-label={t('header.home.title')}
        className="btn-ghost shrink-0 px-2 hover:border-signal/50 hover:bg-signal/10 hover:text-signal"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M12 3.2 2.6 11.4l1.3 1.5L5 12v8.2h5.2v-5.4h3.6v5.4H19V12l1.1.9 1.3-1.5z" />
        </svg>
        <span className="hidden xl:inline">{t('action.home')}</span>
      </button>

      <span className="hidden h-5 w-px shrink-0 bg-ink-500 lg:block" />

      {/* La navigation du pipeline ne se replie jamais : c'est la structure. */}
      <PipelineRail />

      <span className="hidden h-5 w-px shrink-0 bg-ink-500 lg:block" />

      <input
        value={scene.project.name}
        onChange={(e) => patchScene({ project: { ...scene.project, name: e.target.value } })}
        aria-label={t('header.project')}
        title={t('header.project')}
        className="hidden w-32 min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-medium text-white outline-none transition-colors hover:border-ink-500 focus:border-signal/50 lg:block xl:w-44"
      />

      {/* Metadonnees : informatives, donc les premieres a se replier. */}
      <div className="hidden items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white/70 2xl:flex">
        <span className="rounded border border-ink-500 px-1.5 py-0.5">{scene.project.aspectRatio}</span>
        <span className="rounded border border-ink-500 px-1.5 py-0.5">
          {scene.project.duration}s &middot; {scene.project.fps}p
        </span>
        <span className="rounded border border-ink-500 px-1.5 py-0.5">{scene.camera.lens}mm</span>
      </div>

      {screen === 'blocking' && solve && (
        <span
          className={`hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] xl:block ${
            solve.collision.worst
              ? 'border-alert/50 bg-alert/10 text-alert'
              : 'border-ok/40 bg-ok/10 text-ok'
          }`}
        >
          {solve.collision.worst
            ? t('header.contacts', { n: solve.collision.hits.length })
            : t('header.clear')}
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2 lg:gap-3">
        {/* Un rendu en vol reste visible depuis n'importe quel ecran. */}
        {rendering && screen !== 'render' && (
          <button
            type="button"
            onClick={() => goTo('render')}
            className="flex items-center gap-1.5 rounded border border-signal/50 bg-signal/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-signal transition-colors hover:bg-signal/20"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-signal" />
            </span>
            <span className="hidden sm:inline">{t('header.rendering')}</span>
          </button>
        )}

        {/* Bascule de langue : discrete mais toujours atteignable. */}
        <div role="group" aria-label={t('header.language')} className="flex rounded border border-ink-500 p-0.5">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLang(l.id)}
              aria-pressed={lang === l.id}
              title={l.name}
              className={`rounded px-1.5 py-1 font-mono text-[11px] tracking-[0.1em] transition-colors ${
                lang === l.id ? 'bg-signal/20 text-signal' : 'text-white/70 hover:text-white'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>

        <ExportMenu />

        <div className="flex shrink-0 items-center gap-2" title={apiMessage || t(status.key)}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${status.color}`} />
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.14em] text-white/70 xl:inline">
            {creditsSpent > 0 ? `${creditsSpent.toFixed(2)} cr` : t(status.key)}
          </span>
        </div>
      </div>
    </header>
  );
}
