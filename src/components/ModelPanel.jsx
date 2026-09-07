import React from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import Spinner from './Spinner.jsx';
import { inferType, inferActorType, propBounds, PROXY_BOUNDS, TYPE_LABELS } from '../proxies/registry.js';

// Modelisation 3D par GPT-6 Astra.
//
// Le SceneGraph decrit ce qu'il y a dans la scene ; ici on demande au modele
// d'ecrire la geometrie elle-meme. Deux cibles : three.js pour un rendu
// immediat dans le navigateur, Python pour l'export Blender. Le gabarit calcule
// par l'app est impose au modele, de sorte qu'un modele detaille ne deplace ni
// le cadrage ni les volumes de collision.

const TARGETS = [
  { id: 'three', label: 'Navigateur', hint: 'Geometrie three.js, rendue tout de suite' },
  { id: 'blender', label: 'Blender', hint: 'Fonction Python injectee dans l\'export' },
];

export default function ModelPanel() {
  const t = useT();
  const scene = useStore((s) => s.scene);
  const selection = useStore((s) => s.selection);
  const modeling = useStore((s) => s.modeling);
  const modelError = useStore((s) => s.modelError);
  const generateModel = useStore((s) => s.generateModel);
  const clearModel = useStore((s) => s.clearModel);
  const dismissModelError = useStore((s) => s.dismissModelError);
  const apiKey = useStore((s) => s.apiKey);

  if (!scene) return null;

  const actor = selection?.kind === 'actor' ? scene.actors.find((a) => a.id === selection.id) : null;
  const prop = selection?.kind === 'prop' ? scene.props.find((p) => p.id === selection.id) : null;
  const entity = actor || prop;

  const modelled = Object.keys(scene.models || {}).length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/70">{t('model.title')}</h3>
        {modelled > 0 && (
          <span className="rounded bg-ok/15 px-1.5 py-0.5 font-mono text-[11px] text-ok">
            {modelled} modele{modelled > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {!entity ? (
        <p className="text-[12px] leading-relaxed text-white/70">
          Selectionne un acteur ou un objet pour que gpt-6-astra en ecrive la geometrie, a la place du
          proxy generique.
        </p>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: entity.color }} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-white/85">{entity.name}</span>
            <span className="shrink-0 rounded bg-ink-600 px-1.5 py-0.5 font-mono text-[11px] uppercase text-white/70">
              {TYPE_LABELS[actor ? inferActorType(actor) : inferType(prop, 'generic')]}
            </span>
          </div>

          {(() => {
            const b = actor
              ? { ...PROXY_BOUNDS[inferActorType(actor)], height: actor.height }
              : propBounds(prop);
            return (
              <p className="mb-2 font-mono text-[11px] text-white/55">
                {t('model.bounds', { w: b.width.toFixed(2), h: b.height.toFixed(2), d: b.depth.toFixed(2) })}
              </p>
            );
          })()}

          <div className="space-y-1.5">
            {TARGETS.map((target) => {
              const has = Boolean(scene.models?.[entity.id]?.[target.id]);
              const busy = modeling === `${entity.id}:${target.id}`;
              return (
                <div key={target.id} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => generateModel(entity.id, target.id)}
                    disabled={busy || !apiKey}
                    title={t(target.hint)}
                    className={`flex-1 rounded border px-2 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      has
                        ? 'border-ok/40 bg-ok/10 text-ok'
                        : 'border-ink-500 bg-ink-700 text-white/80 hover:border-signal/40 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em]">
                      {busy && <Spinner />}
                      {busy
                        ? t('model.working')
                        : has
                          ? t('model.regenerate', { target: t(target.label) })
                          : t('model.make', { target: t(target.label) })}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug opacity-60">{t(target.hint)}</span>
                  </button>
                  {has && (
                    <button
                      type="button"
                      onClick={() => clearModel(entity.id, target.id)}
                      title={t('action.reset')}
                      className="shrink-0 rounded border border-ink-500 bg-ink-700 px-2 py-2 font-mono text-[11px] text-white/70 transition hover:text-alert"
                    >
                      x
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {!apiKey && (
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-white/55">
              {t('model.needKey')}
            </p>
          )}
        </>
      )}

      {modelError && (
        <div className="mt-2 rounded border border-alert/40 bg-alert/10 px-2 py-1.5">
          <p className="text-[11px] leading-relaxed text-alert">{modelError}</p>
          <button
            type="button"
            onClick={dismissModelError}
            className="mt-1 font-mono text-[11px] text-white/70 hover:text-white"
          >
            fermer
          </button>
        </div>
      )}
    </div>
  );
}
