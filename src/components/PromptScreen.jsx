import React, { useMemo, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';

// Etape 2 — le prompt.
//
// Il existait en deux endroits qui ne produisaient pas le meme texte : le menu
// d'export l'assemblait sans savoir que des passes de reference etaient jointes,
// et omettait donc l'instruction qui empeche Seedance de copier l'esthetique
// proxy. Il n'y a plus qu'une source, et c'est cet ecran.

const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'scene';

function Stat({ label, value, tone = '' }) {
  return (
    <div className="rounded border border-ink-600 bg-ink-800/60 px-3 py-2">
      <div className="label-micro">{label}</div>
      <div className={`mt-1 font-mono text-[13px] tabular-nums ${tone || 'text-white/90'}`}>{value}</div>
    </div>
  );
}

export default function PromptScreen() {
  const t = useT();
  const scene = useStore((s) => s.scene);
  const solve = useStore((s) => s.solve);
  const clips = useStore((s) => s.clips);
  const promptDraft = useStore((s) => s.promptDraft);
  const setPromptDraft = useStore((s) => s.setPromptDraft);
  const resetPromptDraft = useStore((s) => s.resetPromptDraft);
  const seedancePrompt = useStore((s) => s.seedancePrompt);
  const goTo = useStore((s) => s.goTo);
  const [copied, setCopied] = useState(false);

  const prompt = useMemo(() => seedancePrompt(), [seedancePrompt, scene, solve, clips, promptDraft]);
  if (!scene || !solve) return null;

  const clipCount = Object.keys(clips).length;
  const edited = promptDraft != null;
  const targetActor = scene.actors.find((a) => a.id === scene.camera.target);
  const beats = solve.actorPaths.get(scene.camera.target)?.route?.zones.length || 1;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([prompt], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(scene.project.name)}-seedance-prompt.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto bg-ink-900">
      <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8 lg:py-10">
        <header className="mb-6 border-b border-ink-600 pb-5">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t('prompt.title')}</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/70">
{t('prompt.body')}
          </p>
        </header>

        <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t('prompt.stat.duration')} value={`${scene.project.duration} s`} />
          <Stat label={t('prompt.stat.lens')} value={`${scene.camera.lens} mm ${scene.camera.rig}`} />
          <Stat label={t('prompt.stat.beats')} value={t('prompt.stat.beats.value', { n: beats })} />
          <Stat
            label={t('prompt.stat.passes')}
            value={clipCount ? `${clipCount} / 2` : t('prompt.stat.passes.none')}
            tone={clipCount === 2 ? 'text-ok' : clipCount ? 'text-white/90' : 'text-white/55'}
          />
        </div>

        {/* La difference que font les passes n'est pas un detail de reglage :
            sans elles le prompt perd l'instruction anti-proxy. */}
        <div
          className={`mb-5 rounded border px-3 py-2.5 text-[12px] leading-relaxed ${
            clipCount
              ? 'border-ok/35 bg-ok/10 text-ok/90'
              : 'border-ink-600 bg-ink-800/60 text-white/70'
          }`}
        >
          {clipCount ? (
t('prompt.withPasses')
          ) : (
t('prompt.withoutPasses')
          )}
        </div>

        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="seedance-prompt" className="label-micro">
            {edited ? t('prompt.label.edited') : t('prompt.label.generated')}
          </label>
          {edited && (
            <button
              type="button"
              onClick={resetPromptDraft}
              className="font-mono text-[11px] text-white/70 underline underline-offset-2 transition-colors hover:text-white"
            >
              {t('prompt.regenerate')}
            </button>
          )}
        </div>

        <textarea
          id="seedance-prompt"
          value={prompt}
          onChange={(e) => setPromptDraft(e.target.value)}
          rows={22}
          spellCheck={false}
          className="w-full resize-y rounded border border-ink-500 bg-ink-900 p-3.5 font-mono text-[12px] leading-relaxed text-white/80 outline-none transition-colors focus:border-signal/60"
        />

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span
            className={`font-mono text-[11px] tabular-nums ${
              prompt.length > 30000 ? 'text-alert' : 'text-white/55'
            }`}
          >
            {t('prompt.chars', { n: prompt.length.toLocaleString() })}
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={copy} className="btn-ghost">
              {copied ? t('action.copied') : t('action.copy')}
            </button>
            <button type="button" onClick={download} className="btn-ghost">
              {t('action.download')} .txt
            </button>
            <button type="button" onClick={() => goTo('render')} className="btn-primary">
              {t('prompt.toRender')}
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                <path d="m9 6 6 6-6 6z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
