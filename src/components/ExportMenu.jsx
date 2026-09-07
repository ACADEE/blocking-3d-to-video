import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import { buildBlenderScript } from '../export/blender.js';

const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'scene';

function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportMenu() {
  const t = useT();
  const scene = useStore((s) => s.scene);
  const solve = useStore((s) => s.solve);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null); // { title, body, filename, mime, hint }
  const [copied, setCopied] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (e) => e.key === 'Escape' && setPreview(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  if (!scene || !solve) return null;
  const base = slug(scene.project.name);

  const exportJson = () => {
    const { project, environment, zones, actors, props, camera } = scene;
    download(
      `${base}-scenegraph.json`,
      JSON.stringify({ project, environment, zones, actors, props, camera }, null, 2),
      'application/json'
    );
    useStore.setState({ dirty: false });
    setOpen(false);
  };

  const openPreview = () => {
    setOpen(false);
    setCopied(false);
    setPreview({
      title: t('export.blender'),
      body: buildBlenderScript(scene, solve),
      filename: `${base}-blocking.py`,
      mime: 'text/x-python',
      hint: t('export.blender.usage'),
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preview.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const item =
    'flex w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-ink-600/70';

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition ${
          open
            ? 'border-signal/50 bg-signal/10 text-signal'
            : 'border-ink-500 bg-ink-700 text-white/55 hover:text-white'
        }`}
      >
        <span className="hidden sm:inline">{t('action.export')}</span>
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-72 overflow-hidden rounded border border-ink-500 bg-ink-800 shadow-2xl">
          <p className="border-b border-ink-600 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white/55">
            {t('action.advanced')}
          </p>
          <button type="button" className={item} onClick={exportJson}>
            <span className="text-[13px] text-white/90">{t('export.json')}</span>
            <span className="text-[12px] leading-snug text-white/70">
              {t('export.json.hint')}
            </span>
          </button>
          <button type="button" className={item} onClick={openPreview}>
            <span className="text-[13px] text-white/90">{t('export.blender')}</span>
            <span className="text-[12px] leading-snug text-white/70">
              {t('export.blender.hint')}
            </span>
          </button>
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
          onMouseDown={(e) => e.target === e.currentTarget && setPreview(null)}
        >
          <div className="flex h-full max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded border border-ink-500 bg-ink-800 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-ink-600 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-white">{preview.title}</h2>
                <p className="mt-1 text-[12px] leading-relaxed text-white/70">{preview.hint}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="shrink-0 rounded border border-ink-500 px-2 py-1 font-mono text-[11px] text-white/80 transition hover:text-white"
              >
                {t('action.close')}
              </button>
            </div>

            <pre className="flex-1 overflow-auto bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-white/70">
              {preview.body}
            </pre>

            <div className="flex items-center gap-2 border-t border-ink-600 px-4 py-3">
              <span className="font-mono text-[11px] text-white/55">
                {preview.filename} &middot; {(preview.body.length / 1024).toFixed(1)} ko
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="rounded border border-ink-500 bg-ink-700 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white/80 transition hover:text-white"
                >
                  {copied ? t('action.copied') : t('action.copy')}
                </button>
                <button
                  type="button"
                  onClick={() => download(preview.filename, preview.body, preview.mime)}
                  className="rounded border border-signal/50 bg-signal/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-signal transition hover:bg-signal/25"
                >
                  {t('action.download')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
