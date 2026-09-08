import React, { useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import { formatTimecodeFrames } from '../scene/collision.js';

// Barre d'edition du viewport.
//
// Elle porte le mode courant et, surtout, les actions qui dependent de ce qui
// est selectionne. Un acteur ne se deplace pas comme un objet : il n'a pas de
// position, il a une trajectoire. La barre dit donc ce qui est possible ici et
// maintenant, au lieu d'offrir des commandes inertes.

const MODES = [
  { id: 'select', label: 'edit.select', hint: 'edit.select.hint', icon: 'M4 3l16 8-7 2-2 7z' },
  { id: 'translate', label: 'edit.move', hint: 'edit.move.hint', icon: 'M12 2l3 3h-2v5h5V8l3 3-3 3v-2h-5v5h2l-3 3-3-3h2v-5H6v2l-3-3 3-3v2h5V5H9z' },
  { id: 'rotate', label: 'edit.rotate', hint: 'edit.rotate.hint', icon: 'M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z' },
];

export default function EditToolbar() {
  const t = useT();
  const scene = useStore((s) => s.scene);
  const selection = useStore((s) => s.selection);
  const editMode = useStore((s) => s.editMode);
  const setEditMode = useStore((s) => s.setEditMode);
  const viewMode = useStore((s) => s.viewMode);
  const time = useStore((s) => s.time);
  const detachActorPath = useStore((s) => s.detachActorPath);
  const resetActorPath = useStore((s) => s.resetActorPath);
  const setCameraKeyAtTime = useStore((s) => s.setCameraKeyAtTime);
  const clearCameraKeys = useStore((s) => s.clearCameraKeys);
  const cameraAtTime = useStore((s) => s.cameraAtTime);
  const [open, setOpen] = useState(true);

  if (!scene) return null;

  const actor = selection?.kind === 'actor' ? scene.actors.find((a) => a.id === selection.id) : null;
  const inDirector = viewMode === 'director';
  const keys = scene.camera.keys;

  const keyCamera = () => {
    const frame = cameraAtTime(time);
    setCameraKeyAtTime(
      [frame.position.x, frame.position.y, frame.position.z],
      [frame.lookAt.x, frame.lookAt.y, frame.lookAt.z]
    );
  };

  return (
    <div className="pointer-events-auto w-64 rounded border border-ink-500 bg-ink-800/92 backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white/70 transition-colors hover:text-white"
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6z" />
        </svg>
        {t('edit.tool')}
      </button>

      {open && (
        <div className="border-t border-ink-600 p-2.5">
          <div role="group" aria-label={t('edit.tool')} className="mb-2 flex rounded border border-ink-500 p-0.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setEditMode(m.id)}
                aria-pressed={editMode === m.id}
                title={t(m.hint)}
                className={`flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
                  editMode === m.id ? 'bg-signal/20 text-signal' : 'text-white/70 hover:text-white'
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                  <path d={m.icon} />
                </svg>
              </button>
            ))}
          </div>

          {inDirector && (
            <p className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-200/85">
              {t('edit.camera.needView')}
            </p>
          )}

          {!selection && !inDirector && (
            <p className="text-[11px] leading-relaxed text-white/70">{t('edit.nothing')}</p>
          )}

          {/* --- Trajectoire d'acteur --- */}
          {actor && (
            <div className="mb-2">
              {actor.waypoints ? (
                <>
                  <p className="mb-1.5 font-mono text-[11px] text-ok">
                    {t('edit.path.authored')} &middot; {t('edit.path.points', { n: actor.waypoints.length })}
                  </p>
                  <p className="mb-2 text-[11px] leading-relaxed text-white/70">{t('edit.path.hint')}</p>
                  <button
                    type="button"
                    onClick={() => resetActorPath(actor.id)}
                    className="btn-ghost w-full"
                  >
                    {t('edit.path.reset')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => detachActorPath(actor.id)}
                  disabled={inDirector}
                  className="btn-ghost w-full"
                >
                  {t('edit.path.detach')}
                </button>
              )}
            </div>
          )}

          {/* --- Cles camera --- */}
          <div className="border-t border-ink-600 pt-2">
            <button
              type="button"
              onClick={keyCamera}
              disabled={inDirector}
              title={t('edit.camera.keyHint', { time: formatTimecodeFrames(time, scene.project.fps) })}
              className="btn-ghost w-full"
            >
              {t('edit.camera.key')}
            </button>
            {keys && (
              <>
                <p className="mt-1.5 font-mono text-[11px] text-ok">
                  {t('edit.camera.keys', { n: keys.length })}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/70">{t('edit.camera.keys.hint')}</p>
                <button type="button" onClick={clearCameraKeys} className="btn-ghost mt-1.5 w-full">
                  {t('edit.camera.clear')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
