import React, { useCallback, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import { formatTimecodeFrames } from '../scene/collision.js';

// Timeline / Sequence.
//
// Le playhead ne possede pas d'horloge : il lit `time` du store, que la boucle
// de rendu 3D fait avancer. Lecture et viewport partagent donc la meme source
// et ne peuvent pas deriver l'un par rapport a l'autre.

const ROW = 'flex items-center gap-2 h-7';
const LABEL =
  'w-28 shrink-0 truncate font-mono text-[11px] uppercase tracking-[0.14em] text-white/70';

function Icon({ d, className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 ${className}`} fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  start: 'M6 5h2v14H6zm3 7l9-7v14z',
  prev: 'M15 5v14l-9-7z',
  next: 'M9 5v14l9-7z',
  loop: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
};

function TransportButton({ onClick, active, title, path, wide }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center rounded border transition ${
        wide ? 'h-8 w-10' : 'h-7 w-7'
      } ${
        active
          ? 'border-signal/60 bg-signal/15 text-signal'
          : 'border-ink-500 bg-ink-700 text-white/80 hover:border-ink-400 hover:text-white'
      }`}
    >
      <Icon d={path} />
    </button>
  );
}

export default function Timeline() {
  const t = useT();
  const scene = useStore((s) => s.scene);
  const solve = useStore((s) => s.solve);
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const rate = useStore((s) => s.rate);
  const loop = useStore((s) => s.loop);
  const setTime = useStore((s) => s.setTime);
  const togglePlay = useStore((s) => s.togglePlay);
  const stepFrames = useStore((s) => s.stepFrames);
  const setRate = useStore((s) => s.setRate);
  const toggleLoop = useStore((s) => s.toggleLoop);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);

  const trackRef = useRef(null);
  const duration = scene?.project.duration ?? 0;
  const fps = scene?.project.fps ?? 24;
  const pct = duration > 0 ? (time / duration) * 100 : 0;

  const scrubTo = useCallback(
    (clientX) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      setTime(ratio * duration);
    },
    [duration, setTime]
  );

  const beginScrub = useCallback(
    (event) => {
      event.preventDefault();
      useStore.setState({ playing: false });
      scrubTo(event.clientX);
      const move = (e) => scrubTo(e.clientX);
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [scrubTo]
  );

  // Graduations : un pas lisible quelle que soit la duree.
  const ticks = useMemo(() => {
    if (duration <= 0) return [];
    const step = duration <= 10 ? 1 : duration <= 30 ? 2 : duration <= 90 ? 5 : 10;
    const out = [];
    for (let t = 0; t <= duration + 1e-6; t += step) out.push(t);
    return out;
  }, [duration]);

  // Plages de contact, regroupees en bandes continues.
  const collisionBands = useMemo(() => {
    if (!solve || !duration) return [];
    const frames = [...solve.collision.collidingFrames].sort((a, b) => a - b);
    if (!frames.length) return [];
    const total = solve.track.frames.length - 1;
    const bands = [];
    let start = frames[0];
    let prev = frames[0];
    for (let i = 1; i <= frames.length; i += 1) {
      const f = frames[i];
      if (f !== prev + 1) {
        bands.push({ from: (start / total) * 100, to: ((prev + 1) / total) * 100 });
        start = f;
      }
      prev = f;
    }
    return bands;
  }, [solve, duration]);

  if (!scene || !solve) return null;

  return (
    <div className="flex h-full flex-col bg-ink-800 text-white/80">
      {/* Transport ------------------------------------------------------- */}
      <div className="flex items-center gap-3 border-b border-ink-600 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <TransportButton onClick={() => setTime(0)} title={t('timeline.start')} path={ICONS.start} />
          <TransportButton onClick={() => stepFrames(-1)} title={t('timeline.prev')} path={ICONS.prev} />
          <button
            type="button"
            onClick={togglePlay}
            title={t('timeline.play')}
            className="flex h-8 w-12 items-center justify-center rounded border border-signal/50 bg-signal/15 text-signal transition hover:bg-signal/25"
          >
            <Icon d={playing ? ICONS.pause : ICONS.play} className="h-4 w-4" />
          </button>
          <TransportButton onClick={() => stepFrames(1)} title={t('timeline.next')} path={ICONS.next} />
          <TransportButton onClick={toggleLoop} active={loop} title={t('timeline.loop')} path={ICONS.loop} />
        </div>

        <div className="flex items-baseline gap-2 font-mono">
          <span data-testid="playhead-timecode" className="text-lg tabular-nums text-white">
            {formatTimecodeFrames(time, fps)}
          </span>
          <span className="text-[11px] uppercase tracking-[0.16em] text-white/55">
            / {formatTimecodeFrames(duration, fps)}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {[0.25, 0.5, 1, 2].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRate(r)}
              className={`rounded px-2 py-1 font-mono text-[11px] transition ${
                rate === r ? 'bg-signal/20 text-signal' : 'text-white/70 hover:text-white/80'
              }`}
            >
              {r}x
            </button>
          ))}
          <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">
            {t('timeline.frame', { n: Math.round(time * fps), total: Math.round(duration * fps) })}
          </span>
        </div>
      </div>

      {/* Pistes ---------------------------------------------------------- */}
      <div className="relative flex-1 overflow-y-auto px-3 py-2">
        <div className="relative" ref={trackRef}>
          {/* Regle, cliquable pour se positionner */}
          <div className={ROW}>
            <span className={LABEL}>{t('timeline.timecode')}</span>
            <div
              className="relative h-6 flex-1 cursor-ew-resize rounded bg-ink-700"
              onMouseDown={beginScrub}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full border-l border-white/10"
                  style={{ left: `${(t / duration) * 100}%` }}
                >
                  <span className="ml-1 font-mono text-[11px] leading-6 text-white/55">{t}s</span>
                </div>
              ))}
            </div>
          </div>

          {/* Acteurs */}
          {scene.actors.map((actor) => {
            const entry = solve.actorPaths.get(actor.id);
            const active = selection?.kind === 'actor' && selection.id === actor.id;
            return (
              <div className={ROW} key={actor.id}>
                <button
                  type="button"
                  onClick={() => select({ kind: 'actor', id: actor.id })}
                  className={`${LABEL} text-left transition hover:text-white/80 ${active ? 'text-signal' : ''}`}
                  title={actor.action || actor.name}
                >
                  {actor.name}
                </button>
                <div className="relative h-4 flex-1 rounded bg-ink-700/60" onMouseDown={beginScrub}>
                  <div
                    className="absolute inset-y-0 rounded"
                    style={{ left: 0, right: 0, background: `${actor.color}44` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded"
                    style={{ width: `${pct}%`, background: `${actor.color}` , opacity: 0.55 }}
                  />
                  {entry?.doorTimes.map((d, i) => (
                    <div
                      key={i}
                      title={`${d.doorway.name} a ${d.time.toFixed(2)}s`}
                      className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 bg-white/70"
                      style={{ left: `${(d.time / duration) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Camera */}
          <div className={ROW}>
            <span className={LABEL}>
              {t('timeline.camera')}{' '}
              {scene.camera.keys ? `(${scene.camera.keys.length})` : `(${scene.camera.rig})`}
            </span>
            <div className="relative h-4 flex-1 rounded bg-ink-700/60" onMouseDown={beginScrub}>
              <div className="absolute inset-0 rounded bg-ok/20" />
              {collisionBands.map((b, i) => (
                <div
                  key={i}
                  className="absolute inset-y-0 bg-alert/70"
                  style={{ left: `${b.from}%`, width: `${Math.max(0.4, b.to - b.from)}%` }}
                />
              ))}
            </div>
          </div>

          {/* Alertes */}
          <div className={ROW}>
            <span className={LABEL}>{t('timeline.alerts')}</span>
            <div className="relative h-4 flex-1 rounded bg-ink-700/60" onMouseDown={beginScrub}>
              {solve.collision.worst && (
                <button
                  type="button"
                  title={`${solve.collision.worst.obstacleName} a ${solve.collision.worst.timecode}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTime(solve.collision.worst.time);
                  }}
                  className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white/70 bg-alert"
                  style={{ left: `${(solve.collision.worst.time / duration) * 100}%` }}
                />
              )}
            </div>
          </div>

          {/* Tete de lecture, au-dessus de toutes les pistes */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-[1.5px] bg-signal"
            style={{ left: `calc(7rem + 0.5rem + (100% - 7rem - 0.5rem) * ${pct / 100})` }}
          >
            <div className="absolute -top-0.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-signal" />
          </div>
        </div>
      </div>
    </div>
  );
}
