import React from 'react';
import { useStore } from '../store/useStore.js';
import Spinner from './Spinner.jsx';

// Panneau d'alerte de collision.
//
// Rien n'est ecrit en dur : le timecode et le nom d'obstacle proviennent du
// balayage de la piste camera contre la geometrie du decor. Si la trajectoire
// est degagee, ce panneau n'existe pas.
//
// Le panneau doit toujours rendre compte de ce que la correction a fait, y
// compris quand elle n'a rien trouve. Sans ce retour, un clic sans effet visible
// se lit comme un bouton casse.

const SOURCE_LABEL = {
  api: 'gpt-6-astra',
  'local-fallback': 'solveur local (repli)',
  local: 'solveur local',
};

export default function SystemAlert() {
  const solve = useStore((s) => s.solve);
  const scene = useStore((s) => s.scene);
  const correcting = useStore((s) => s.correcting);
  const correction = useStore((s) => s.correction);
  const autoCorrect = useStore((s) => s.autoCorrect);
  const undoCorrection = useStore((s) => s.undoCorrection);
  const dismissCorrection = useStore((s) => s.dismissCorrection);
  const setTime = useStore((s) => s.setTime);
  const apiKey = useStore((s) => s.apiKey);

  if (!solve || !scene) return null;

  const hit = solve.collision.worst;

  // --- Trajectoire degagee : bandeau de succes ----------------------------
  if (!hit && correction) {
    return (
      <div className="pointer-events-auto w-[22rem] rounded border border-ok/40 bg-ok/10 p-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ok">Path corrected</span>
          <button
            type="button"
            onClick={dismissCorrection}
            className="rounded px-1 py-0.5 font-mono text-[11px] text-white/70 transition-colors hover:text-white"
          >
            fermer
          </button>
        </div>

        <p className="mt-2 text-[12px] leading-relaxed text-white/80">{correction.note}</p>

        {/* Une variante de rig modifie la prise, pas seulement le chemin :
            l'utilisateur doit voir ce qui a bouge dans son plan. */}
        {correction.change && (
          <p className="mt-2 rounded border border-ok/30 bg-black/25 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ok/90">
            Reglage modifie — {correction.change}
          </p>
        )}

        <p className="mt-1.5 font-mono text-[11px] text-white/70">
          {correction.before.hits} image{correction.before.hits > 1 ? 's' : ''} en contact avec &laquo;&nbsp;
          {correction.before.worst?.obstacleName}&nbsp;&raquo; &rarr; 0. Source :{' '}
          {SOURCE_LABEL[correction.source] || correction.source}.
        </p>

        <button type="button" onClick={undoCorrection} className="btn-ghost mt-2.5 w-full">
          Annuler la correction
        </button>
      </div>
    );
  }

  if (!hit) return null;

  // Une tentative a eu lieu mais n'a pas tout degage : on le dit explicitement,
  // avec les chiffres, plutot que de reafficher le meme panneau a l'identique.
  const attempted = correction && !correction.resolved;
  const noProgress = attempted && correction.after.hits >= correction.before.hits;

  return (
    <div className="pointer-events-auto w-[22rem] rounded border border-alert/50 bg-[#1a0d0d]/90 p-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-alert opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-alert" />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-alert">System alert</span>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-white/90">
        Camera trajectory collision detected at{' '}
        <button
          type="button"
          onClick={() => setTime(hit.time)}
          className="font-mono font-semibold text-alert underline decoration-alert/40 underline-offset-2 hover:decoration-alert"
          title="Placer la tete de lecture sur le contact"
        >
          {hit.timecode}
        </button>{' '}
        with <span className="font-semibold">{hit.obstacleName}</span>.
      </p>

      <div className="mt-2 space-y-0.5">
        {solve.collision.obstacles.map((o) => (
          <div key={o.name} className="flex items-baseline justify-between font-mono text-[11px] text-white/70">
            <span className="truncate pr-2">{o.name}</span>
            <span className="shrink-0 tabular-nums">
              {o.frames} img &middot; {(o.penetration * 100).toFixed(0)} cm
            </span>
          </div>
        ))}
      </div>

      {attempted && (
        <div
          className={`mt-2 rounded border px-2 py-1.5 ${
            noProgress ? 'border-amber-500/40 bg-amber-500/10' : 'border-white/10 bg-black/30'
          }`}
        >
          <p
            className={`text-[12px] leading-relaxed ${
              noProgress ? 'text-amber-200/90' : 'text-white/80'
            }`}
          >
            {correction.note}
          </p>
          {!noProgress && (
            <p className="mt-1 font-mono text-[11px] tabular-nums text-white/70">
              {correction.before.hits} &rarr; {correction.after.hits} images en contact.
            </p>
          )}
          {correction.change && (
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-white/70">
              Reglage modifie — {correction.change}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={autoCorrect}
        disabled={correcting}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded border border-alert/60 bg-alert/15 py-2 font-mono text-[12px] uppercase tracking-[0.18em] text-alert transition-colors hover:bg-alert/25 disabled:cursor-wait disabled:opacity-60"
      >
        {correcting && <Spinner />}
        {correcting ? 'Searching…' : attempted ? 'Retry' : 'Auto-correct path'}
      </button>

      {attempted && correction.change && (
        <button type="button" onClick={undoCorrection} className="btn-ghost mt-1.5 w-full">
          Annuler la modification de reglage
        </button>
      )}

      <p className="mt-1.5 text-center font-mono text-[11px] leading-relaxed text-white/70">
        {correcting
          ? 'Trajectoire, puis variantes de rig'
          : apiKey
            ? 'gpt-6-astra propose, le resultat est rebalaye avant application'
            : 'Trajectoire relachee, puis variantes de rig si le decor resiste'}
      </p>
    </div>
  );
}
