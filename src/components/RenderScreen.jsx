import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import { pickVideoMime, CAPTURE_SIZES } from '../export/recorder.js';
import { RESOLUTIONS } from '../api/seedance.js';
import { isUsableAssetUrl } from '../api/upload.js';

// Etape 3 — le rendu.
//
// Les passes de reference passent AVANT le lecteur de resultat : elles sont ce
// qu'on produit ici, le rendu est ce qu'on recoit. Les afficher apres inversait
// l'ordre de la tache.

const PASSES = [
  { view: 'orbit', title: 'render.pass.iso', detail: 'render.pass.iso.hint' },
  { view: 'director', title: 'render.pass.cam', detail: 'render.pass.cam.hint' },
];

// Duree Seedance : hors de cette plage, l'API refuse.
const DURATION_MIN = 4;
const DURATION_MAX = 30;

function Section({ title, children, aside, tone = 'text-white/70' }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-ink-600 pb-2">
        <h2 className={`font-mono text-[11px] uppercase tracking-[0.2em] ${tone}`}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Field({ label, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label-micro mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" />
    </svg>
  );
}

/** Traduit l'etat brut de l'API en phase lisible. Jamais l'enum a l'ecran. */
function phaseKey(render) {
  if (render.status === 'uploading') return 'render.phase.uploading';
  if (render.status === 'submitting') return 'render.phase.submitting';
  const raw = String(render.message || '').toLowerCase();
  if (raw.includes('queue') || raw.includes('wait')) return 'render.phase.queued';
  if (raw.includes('generat')) return 'render.phase.generating';
  return 'render.phase.polling';
}

export default function RenderScreen() {
  const t = useT();
  const scene = useStore((s) => s.scene);
  const clips = useStore((s) => s.clips);
  const captureError = useStore((s) => s.captureError);
  const startCapture = useStore((s) => s.startCapture);
  const clearClip = useStore((s) => s.clearClip);
  const setClipRemoteUrl = useStore((s) => s.setClipRemoteUrl);
  const dismissCaptureError = useStore((s) => s.dismissCaptureError);
  const submitRender = useStore((s) => s.submitRender);
  const resetRender = useStore((s) => s.resetRender);
  const render = useStore((s) => s.render);
  const apiKey = useStore((s) => s.apiKey);
  const settings = useStore((s) => s.renderSettings);
  const setSettings = useStore((s) => s.setRenderSettings);
  const seedancePrompt = useStore((s) => s.seedancePrompt);
  const goTo = useStore((s) => s.goTo);

  const mime = useMemo(() => pickVideoMime(), []);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const resultRef = useRef(null);
  const videoRefs = useRef({});

  const busy = ['uploading', 'submitting', 'polling'].includes(render.status);

  // L'arrivee du rendu est le sommet du produit : elle vient a l'utilisateur.
  useEffect(() => {
    if (render.status === 'done' && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      resultRef.current.focus({ preventScroll: true });
    }
  }, [render.status]);

  // Fermer l'onglet pendant un rendu fait perdre le suivi : on previent.
  useEffect(() => {
    if (!busy) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  if (!scene) return null;

  const prompt = seedancePrompt();
  const recorded = PASSES.map((p) => ({ ...p, clip: clips[p.view] })).filter((p) => p.clip);
  const nonConform = recorded.filter((r) => r.clip.problems?.length);
  const durationOk = scene.project.duration >= DURATION_MIN && scene.project.duration <= DURATION_MAX;
  const aspect = settings.aspectRatio || scene.project.aspectRatio;

  // Une seule raison de blocage a la fois, la plus proche de l'utilisateur.
  const blocker = !apiKey?.trim()
    ? t('render.block.key')
    : recorded.length < 2
      ? t('render.block.passes', { n: 2 - recorded.length })
      : !durationOk
        ? t('render.block.duration', { n: scene.project.duration })
        : nonConform.length
          ? t('render.block.clips', { n: nonConform.length })
          : !prompt.trim()
            ? t('render.block.prompt')
            : null;

  const download = (clip, view) => {
    const a = document.createElement('a');
    a.href = clip.url;
    a.download = `blocking-${view}.${clip.mime.ext}`;
    a.click();
  };

  // Lecture synchronisee : tout repart de zero et demarre ensemble, sinon on
  // compare des instants differents entre le blocking et le rendu.
  const playAll = () => {
    const players = Object.values(videoRefs.current).filter(Boolean);
    players.forEach((v) => {
      v.currentTime = 0;
    });
    players.forEach((v) => v.play().catch(() => {}));
  };
  const playableCount = recorded.length + render.urls.length;

  return (
    <div className="h-full overflow-y-auto bg-ink-900">
      <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8 lg:py-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-ink-600 pb-5">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{t('render.title')}</h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/70">{t('render.body')}</p>
          </div>
          {playableCount >= 2 && (
            <button
              type="button"
              data-testid="play-all"
              onClick={playAll}
              title={t('render.playAll.hint')}
              className="btn-ghost"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              {t('render.playAll')}
            </button>
          )}
        </header>

        {/* --- 1. Passes de reference, avant le resultat ------------------- */}
        <Section
          title={t('render.passes')}
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={settings.captureSize}
                onChange={(e) => setSettings({ captureSize: e.target.value })}
                aria-label={t('render.passes')}
                className="rounded border border-ink-500 bg-ink-700 px-2 py-1 font-mono text-[11px] text-white/90 outline-none"
              >
                {Object.entries(CAPTURE_SIZES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {t('render.passes.size', { k, label: v.label })}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => startCapture(['orbit', 'director'], settings.captureSize)}
                disabled={!mime}
                className={recorded.length ? 'btn-ghost' : 'btn-primary'}
              >
                {recorded.length ? t('render.passes.rerecord') : t('render.passes.record')}
              </button>
            </div>
          }
        >
          {/* Tant qu'aucune passe n'existe, on dit pourquoi elles comptent —
              avant l'echec, pas au moment de l'appui sur Envoyer. */}
          {recorded.length === 0 && (
            <p className="mb-3 rounded border border-signal/40 bg-signal/10 px-3 py-2.5 text-[12px] leading-relaxed text-signal/90">
              {t('render.why')}
            </p>
          )}

          {!mime && (
            <p className="mb-3 rounded border border-alert/40 bg-alert/10 px-3 py-2 text-[12px] leading-relaxed text-alert">
              {t('capture.noRecorder')}
            </p>
          )}
          {mime && !mime.accepted && (
            <p className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-200/85">
              {t('capture.wrongFormat', { ext: mime.ext })}
            </p>
          )}
          {captureError && (
            <div className="mb-3 flex flex-wrap items-start gap-3 rounded border border-alert/40 bg-alert/10 px-3 py-2">
              <p className="min-w-[12rem] flex-1 text-[12px] leading-relaxed text-alert">{captureError}</p>
              <button
                type="button"
                onClick={() => startCapture(['orbit', 'director'], settings.captureSize)}
                className="btn-ghost shrink-0"
              >
                {t('action.retry')}
              </button>
              <button
                type="button"
                onClick={dismissCaptureError}
                aria-label={t('action.close')}
                className="shrink-0 rounded p-1.5 text-white/70 transition-colors hover:text-white"
              >
                <XIcon />
              </button>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            {PASSES.map(({ view, title, detail }) => {
              const clip = clips[view];
              return (
                <div key={view} className="rounded border border-ink-500 bg-ink-800/50 p-3">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <h3 className="text-[13px] font-medium text-white/90">{t(title)}</h3>
                    {clip && (
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-white/70">
                        {clip.width}&times;{clip.height} &middot; {clip.duration.toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <p className="mb-3 text-[12px] leading-snug text-white/70">{t(detail)}</p>

                  {clip ? (
                    <>
                      <video
                        ref={(el) => {
                          videoRefs.current[view] = el;
                        }}
                        src={clip.url}
                        controls
                        loop
                        muted
                        className="mb-2 w-full rounded border border-ink-600 bg-black"
                      />
                      {clip.problems?.length > 0 && (
                        <ul className="mb-2 space-y-0.5">
                          {clip.problems.map((p) => (
                            <li key={p} className="text-[12px] leading-snug text-alert">
                              {p}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => download(clip, view)} className="btn-ghost flex-1">
                          {t('action.download')}
                        </button>
                        <button
                          type="button"
                          onClick={() => clearClip(view)}
                          aria-label={t('action.delete')}
                          className="btn-ghost px-2 hover:border-alert/50 hover:text-alert"
                        >
                          <XIcon />
                        </button>
                      </div>
                      {(showAdvanced || (clip.remoteUrl && !isUsableAssetUrl(clip.remoteUrl))) && (
                        <div className="mt-2">
                          <label htmlFor={`url-${view}`} className="label-micro mb-1">
                            {t('inspector.reference.url')}
                          </label>
                          <input
                            id={`url-${view}`}
                            value={clip.remoteUrl || ''}
                            onChange={(e) => setClipRemoteUrl(view, e.target.value)}
                            placeholder="https://..."
                            className="field font-mono text-[11px]"
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-ink-500 py-8">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-6 w-6 text-white/55"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        aria-hidden="true"
                      >
                        <rect x="2.5" y="6" width="13" height="12" rx="1.5" />
                        <path d="m16.5 11 5-3v8l-5-3z" />
                      </svg>
                      <p className="text-[12px] text-white/70">{t('render.pass.empty')}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* --- 2. Resultat ------------------------------------------------ */}
        {render.urls.length > 0 && (
          <section ref={resultRef} tabIndex={-1} className="mb-8 outline-none">
            <div className="mb-3 flex items-baseline justify-between border-b border-ok/30 pb-2">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-ok">{t('render.result')}</h2>
              <span className="font-mono text-[11px] tabular-nums text-white/70">
                {t('render.result.elapsed', { n: Math.round(render.elapsed / 1000) })}
              </span>
            </div>
            {render.urls.map((u, i) => (
              <div key={u} className="mb-3">
                <video
                  ref={(el) => {
                    videoRefs.current[`result-${i}`] = el;
                  }}
                  src={u}
                  controls
                  className="w-full rounded border border-ink-600 bg-black"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a href={u} download className="btn-ghost">
                    {t('render.result.download')}
                  </a>
                  <a href={u} target="_blank" rel="noreferrer" className="btn-ghost">
                    {t('render.result.open')}
                  </a>
                  <button type="button" onClick={() => goTo('prompt')} className="btn-ghost">
                    {t('render.result.again')}
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* --- 3. Attente ------------------------------------------------- */}
        {busy && (
          <section className="mb-8 rounded border border-signal/40 bg-signal/10 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-70" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-signal" />
              </span>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">
                {t('render.wait.title')}
              </h2>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-white/70">
                {t('render.wait.elapsed', {
                  n: `${Math.floor(render.elapsed / 60000)}:${String(
                    Math.floor((render.elapsed % 60000) / 1000)
                  ).padStart(2, '0')}`,
                })}
              </span>
            </div>

            {/* Barre indeterminee : la duree reelle est inconnue, la feindre
                serait mentir. Elle dit "ca travaille", pas "on en est la". */}
            <div className="mb-2.5 h-1 overflow-hidden rounded bg-ink-600">
              <div className="indeterminate h-full w-1/3 rounded bg-signal" />
            </div>

            <p className="text-[12px] leading-relaxed text-white/80">{t(phaseKey(render))}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-white/70">{t('render.wait.body')}</p>
            {render.taskId && (
              <p className="mt-1.5 font-mono text-[11px] text-white/70">
                {t('render.task', { id: render.taskId })}
              </p>
            )}
          </section>
        )}

        {/* --- 4. Prompt, en lecture seule -------------------------------- */}
        <Section
          title={t('render.prompt')}
          aside={
            <button
              type="button"
              onClick={() => goTo('prompt')}
              className="-my-1 py-1 font-mono text-[11px] text-signal underline underline-offset-2 transition-colors hover:text-[#ff8f3a]"
            >
              {t('render.prompt.edit')}
            </button>
          }
        >
          <p className="rounded border border-ink-600 bg-ink-800/50 p-3 font-mono text-[11px] leading-relaxed text-white/70">
            {prompt.slice(0, 400)}
            {prompt.length > 400 ? '...' : ''}
          </p>
          <p className="mt-1.5 font-mono text-[11px] tabular-nums text-white/70">
            {t('render.prompt.chars', { n: prompt.length.toLocaleString() })}
          </p>
        </Section>

        {/* --- 5. Reglages ------------------------------------------------ */}
        <Section title={t('render.settings')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('render.resolution')} htmlFor="res">
              <select
                id="res"
                value={settings.resolution}
                onChange={(e) => setSettings({ resolution: e.target.value })}
                className="field"
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('render.aspect')} htmlFor="ar">
              <select
                id="ar"
                value={settings.aspectRatio || ''}
                onChange={(e) => setSettings({ aspectRatio: e.target.value || null })}
                className="field"
              >
                <option value="">{t('render.aspect.scene', { v: scene.project.aspectRatio })}</option>
                {['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('render.duration')} htmlFor="dur">
              <div
                id="dur"
                className={`field flex items-center justify-between ${durationOk ? '' : 'border-alert/60 text-alert'}`}
              >
                <span className="tabular-nums">{scene.project.duration} s</span>
                <span className="font-mono text-[11px] text-white/70">
                  {DURATION_MIN}&ndash;{DURATION_MAX}
                </span>
              </div>
            </Field>
            <Field label={t('render.audio')} htmlFor="aud">
              <button
                id="aud"
                type="button"
                onClick={() => setSettings({ generateAudio: !settings.generateAudio })}
                aria-pressed={settings.generateAudio}
                className={`field text-left ${settings.generateAudio ? 'text-ok' : 'text-white/70'}`}
              >
                {settings.generateAudio ? t('render.audio.on') : t('render.audio.off')}
              </button>
            </Field>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="mt-3 flex items-center gap-1.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/70 transition-colors hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="m9 6 6 6-6 6z" />
            </svg>
            {t('action.advanced')}
          </button>

          {showAdvanced && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t('render.images')} htmlFor="imgs">
                <textarea
                  id="imgs"
                  value={settings.imageUrls}
                  onChange={(e) => setSettings({ imageUrls: e.target.value })}
                  rows={2}
                  placeholder="https://.../moodboard.jpg"
                  className="field resize-y font-mono text-[11px]"
                />
              </Field>
              <Field label={t('render.audioUrls')} htmlFor="auds">
                <textarea
                  id="auds"
                  value={settings.audioUrls}
                  onChange={(e) => setSettings({ audioUrls: e.target.value })}
                  rows={2}
                  placeholder="https://.../ambiance.mp3"
                  className="field resize-y font-mono text-[11px]"
                />
              </Field>
            </div>
          )}
        </Section>

        {/* --- Recapitulatif et envoi ------------------------------------- */}
        <div className="sticky bottom-0 -mx-4 border-t border-ink-600 bg-ink-900/95 px-4 py-4 backdrop-blur lg:-mx-8 lg:px-8">
          <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-white/70">
            <span>
              {t('render.recap', {
                passes: recorded.length,
                duration: scene.project.duration,
                resolution: settings.resolution,
                aspect,
                audio: settings.generateAudio ? t('render.audio.on') : t('render.audio.off'),
              })}
            </span>
            <span className="text-white/70">{t('render.cost')}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p
              className={`min-w-[14rem] flex-1 text-[12px] leading-snug ${
                render.status === 'error'
                  ? 'text-alert'
                  : render.status === 'done'
                    ? 'text-ok'
                    : blocker
                      ? 'text-amber-200/85'
                      : 'text-white/70'
              }`}
            >
              {render.status === 'error' ? render.message : blocker || t('render.ready')}
            </p>

            {(render.status === 'error' || render.status === 'done') && (
              <button type="button" onClick={resetRender} className="btn-ghost">
                {render.status === 'error' ? t('action.retry') : t('render.new')}
              </button>
            )}

            <button
              type="button"
              disabled={busy || Boolean(blocker)}
              onClick={submitRender}
              className="btn-primary"
            >
              {busy ? t('render.sending') : t('render.send')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
