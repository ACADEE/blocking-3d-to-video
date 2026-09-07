import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import Viewport from './Viewport.jsx';
import { recordCanvas, validateClip } from '../export/recorder.js';

// Etage de capture.
//
// Le viewport principal est dimensionne par la mise en page ; Seedance impose
// des dimensions precises. On monte donc un viewport dedie a la taille exacte
// demandee, avec devicePixelRatio force a 1 pour que le buffer du canvas fasse
// bien 1280x720 et pas le double. L'element est affiche reduit par une simple
// transformation CSS, ce qui ne touche pas au buffer.

const PASS_LABEL = { orbit: 'capture.pass1', director: 'capture.pass2' };

export default function CaptureStage() {
  const t = useT();
  const capture = useStore((s) => s.capture);
  const scene = useStore((s) => s.scene);
  const finishPass = useStore((s) => s.finishCapturePass);
  const failCapture = useStore((s) => s.failCapture);
  const cancelCapture = useStore((s) => s.cancelCapture);

  const hostRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('capture.preparing');
  const cancelled = useRef(false);

  const { view, width, height } = capture || {};

  useEffect(() => {
    if (!capture || !scene) return undefined;
    cancelled.current = false;
    let alive = true;

    const run = async () => {
      const store = useStore.getState();
      // Le rendu doit etre stabilise avant de lancer l'enregistrement, sinon on
      // capture les premieres images d'une scene encore en cours de montage.
      store.setViewMode(view);
      store.setTime(0);
      useStore.setState({ playing: false, selection: null });
      setPhase('capture.preparing');
      await new Promise((r) => setTimeout(r, 900));
      if (!alive || cancelled.current) return;

      const canvas = hostRef.current?.querySelector('canvas');
      if (!canvas) {
        failCapture(t('capture.noCanvas'));
        return;
      }

      try {
        setPhase('capture.recording');
        const duration = scene.project.duration;
        useStore.setState({ time: 0, playing: true, rate: 1, loop: false });

        const { blob, mime, duration: measured } = await recordCanvas({
          canvas,
          fps: scene.project.fps,
          durationMs: duration * 1000,
          onProgress: (r) => alive && setProgress(r),
          shouldStop: () => cancelled.current,
        });

        useStore.setState({ playing: false });
        if (!alive || cancelled.current) return;

        const problems = validateClip({
          width: canvas.width,
          height: canvas.height,
          duration: measured,
          size: blob.size,
        });

        finishPass({
          view,
          blob,
          mime,
          duration: measured,
          width: canvas.width,
          height: canvas.height,
          size: blob.size,
          problems,
          url: URL.createObjectURL(blob),
        });
      } catch (err) {
        useStore.setState({ playing: false });
        if (alive && !cancelled.current) failCapture(err.message);
      }
    };

    run();
    return () => {
      alive = false;
    };
    // Une passe = une combinaison vue + identifiant : on relance a chaque passe.
  }, [capture?.passId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!capture || !scene) return null;

  // R3F dimensionne le canvas d'apres la taille mesuree du conteneur, et une
  // transformation CSS fausserait cette mesure. On affiche donc le conteneur a
  // sa taille reduite reelle, et on compense par le devicePixelRatio pour que le
  // buffer retombe exactement sur la definition visee :
  //   canvas.width = boxW x (width / boxW) = width
  // La largeur d'affichage est arrondie a un multiple de 16 pour que la hauteur
  // tombe juste elle aussi.
  const raw = Math.min(1, (window.innerWidth - 140) / width, (window.innerHeight - 280) / height);
  const boxW = Math.max(160, Math.floor((width * raw) / 16) * 16);
  const boxH = Math.round((boxW * height) / width);
  const bufferDpr = width / boxW;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-black/92 p-6">
      <div className="text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">
          {t(PASS_LABEL[view]) || view}
        </p>
        <p className="mt-1 font-mono text-[12px] text-white/70">
          {width} x {height} &middot; {scene.project.fps} img/s &middot; {scene.project.duration}s &middot;{' '}
          {t(phase)}
        </p>
      </div>

      <div className="overflow-hidden border border-ink-500 shadow-2xl">
        <div ref={hostRef} style={{ width: boxW, height: boxH }}>
          <Viewport dpr={bufferDpr} capture />
        </div>
      </div>

      <div className="w-[28rem] max-w-full">
        <div className="h-1 overflow-hidden rounded bg-ink-600">
          <div
            className="h-full bg-signal transition-[width] duration-100"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-white/70">
          <span>{Math.round(progress * 100)} %</span>
          <button
            type="button"
            onClick={() => {
              cancelled.current = true;
              cancelCapture();
            }}
            className="uppercase tracking-[0.16em] transition hover:text-alert"
          >
            {t('action.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
