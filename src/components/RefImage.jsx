import React, { useRef, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import Spinner from './Spinner.jsx';
import { isUsableAssetUrl } from '../api/upload.js';

// Image de reference attachee a un element.
//
// Seedance ne recoit qu'une liste plate d'URL : c'est le prompt genere qui dira
// "reference image 2 shows the KITCHEN". Le rattachement se fait donc ici, et
// l'ordre d'envoi doit correspondre a la numerotation — voir orderedRefs().
//
// Comme pour les passes video, la mise en ligne est faite au mieux : si le
// service de fichiers kie.ai n'est pas joignable depuis le navigateur, on
// bascule sur la saisie d'URL, qui elle marche toujours.

export default function RefImage({ entityId, entityName }) {
  const t = useT();
  const scene = useStore((s) => s.scene);
  const setEntityRef = useStore((s) => s.setEntityRef);
  const clearEntityRef = useStore((s) => s.clearEntityRef);
  const uploadEntityRef = useStore((s) => s.uploadEntityRef);
  const uploadingRef = useStore((s) => s.uploadingRef);
  const refError = useStore((s) => s.refError);
  const [manual, setManual] = useState(false);
  const fileRef = useRef(null);

  const ref = scene?.refs?.[entityId];
  const busy = uploadingRef === entityId;

  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadEntityRef(entityId, file, entityName);
    e.target.value = '';
  };

  return (
    <div className="mt-1.5 rounded border border-ink-600 bg-ink-800/40 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="label-micro">{t('inspector.reference')}</span>
        {ref && (
          <button
            type="button"
            onClick={() => clearEntityRef(entityId)}
            className="py-0.5 font-mono text-[11px] text-white/70 transition-colors hover:text-alert"
          >
            {t('inspector.reference.remove')}
          </button>
        )}
      </div>

      {ref ? (
        <>
          <img
            src={ref.url}
            alt={entityName}
            className="mb-1.5 h-20 w-full rounded border border-ink-600 object-cover"
          />
          <p className="truncate font-mono text-[11px] text-white/70">{ref.url}</p>
        </>
      ) : (
        <>
          <p className="mb-2 text-[11px] leading-relaxed text-white/70">{t('inspector.reference.hint')}</p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="btn-ghost flex-1"
            >
              {busy && <Spinner />}
              {busy ? t('inspector.reference.uploading') : t('inspector.reference.add')}
            </button>
            <button
              type="button"
              onClick={() => setManual((v) => !v)}
              aria-expanded={manual}
              className="btn-ghost px-2"
              title={t('inspector.reference.url')}
            >
              URL
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />

          {(manual || refError) && (
            <input
              defaultValue=""
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (isUsableAssetUrl(v)) setEntityRef(entityId, v, entityName);
              }}
              placeholder="https://..."
              className="field mt-1.5 font-mono text-[11px]"
            />
          )}
          {refError && <p className="mt-1.5 text-[11px] leading-relaxed text-alert">{refError}</p>}
        </>
      )}
    </div>
  );
}
