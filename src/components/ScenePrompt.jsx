import React, { useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';

// Ajout d'elements a la scene en langage courant.
//
// Le modele renvoie un patch, jamais un graphe complet : c'est ce qui permet
// d'ajouter une voiture sans defaire les trajectoires et les positions reglees
// a la main juste avant.

export default function ScenePrompt() {
  const t = useT();
  const scene = useStore((s) => s.scene);
  const apiKey = useStore((s) => s.apiKey);
  const editScene = useStore((s) => s.editScene);
  const editing = useStore((s) => s.sceneEditing);
  const error = useStore((s) => s.sceneEditError);
  const note = useStore((s) => s.sceneEditNote);
  const dismiss = useStore((s) => s.dismissSceneEdit);
  const [value, setValue] = useState('');

  if (!scene) return null;

  const submit = (e) => {
    e.preventDefault();
    if (!value.trim() || editing) return;
    editScene(value);
    setValue('');
  };

  const summary =
    note && typeof note === 'object'
      ? [
          note.added ? t('scenePrompt.added', { n: note.added }) : null,
          note.updated ? t('scenePrompt.updated', { n: note.updated }) : null,
          note.removed ? t('scenePrompt.removed', { n: note.removed }) : null,
        ]
          .filter(Boolean)
          .join(', ')
      : null;

  return (
    <form onSubmit={submit} className="pointer-events-auto w-64 rounded border border-ink-500 bg-ink-800/92 p-2.5 backdrop-blur">
      <label htmlFor="scene-prompt" className="label-micro mb-1.5">
        {t('scenePrompt.label')}
      </label>
      <div className="flex gap-1.5">
        <input
          id="scene-prompt"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('scenePrompt.placeholder')}
          disabled={editing}
          className="field min-w-0 flex-1 text-[12px]"
        />
        <button type="submit" disabled={editing || !value.trim() || !apiKey} className="btn-ghost px-2.5">
          {editing ? '…' : t('scenePrompt.send')}
        </button>
      </div>

      {!apiKey && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/70">{t('scenePrompt.needKey')}</p>
      )}

      {editing && (
        <p className="mt-1.5 font-mono text-[11px] text-signal">{t('scenePrompt.working')}</p>
      )}

      {summary && (
        <p className="mt-1.5 flex items-start gap-2 text-[11px] leading-relaxed text-ok">
          <span className="min-w-0 flex-1">{t('scenePrompt.applied', { summary })}</span>
          <button type="button" onClick={dismiss} className="shrink-0 text-white/70 hover:text-white">
            ×
          </button>
        </p>
      )}

      {note === 'scenePrompt.nothing' && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/85">{t('scenePrompt.nothing')}</p>
      )}

      {error && (
        <p className="mt-1.5 flex items-start gap-2 text-[11px] leading-relaxed text-alert">
          <span className="min-w-0 flex-1">{error.startsWith('scenePrompt.') ? t(error) : error}</span>
          <button type="button" onClick={dismiss} className="shrink-0 text-white/70 hover:text-white">
            ×
          </button>
        </p>
      )}
    </form>
  );
}
