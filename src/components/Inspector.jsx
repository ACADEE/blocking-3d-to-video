import React, { useState } from 'react';
import { useStore } from '../store/useStore.js';
import { CAMERA_RIGS } from '../scene/normalize.js';
import { inferActorType, inferType, TYPE_LABELS } from '../proxies/registry.js';
import { HUMAN_SPEED } from '../scene/paths.js';
import ModelPanel from './ModelPanel.jsx';
import RefImage, { RefThumb } from './RefImage.jsx';
import { useT } from '../i18n/index.js';

/**
 * Section repliable. L'inspecteur empilait huit blocs toujours ouverts dans une
 * colonne de 288 px : les zones et les avertissements etaient hors ecran en
 * permanence sur un portable.
 */
function Section({ title, children, right, defaultOpen = true, tone = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-ink-600">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
            tone || 'text-white/70'
          } hover:text-white`}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-3 w-3 shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="m9 6 6 6-6 6z" />
          </svg>
          <span className="truncate">{title}</span>
        </button>
        {right}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

function Field({ label, value, children }) {
  return (
    <label className="mb-2 block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/70">{label}</span>
        {value != null && <span className="font-mono text-[11px] tabular-nums text-white/70">{value}</span>}
      </div>
      {children}
    </label>
  );
}

// Un role="button" plutot qu'un <button> : la vignette de reference (RefThumb)
// est elle-meme un bouton, et un bouton ne peut pas en contenir un autre.
function Row({ active, color, title, subtitle, badge, onClick, testId, trailing }) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={testId}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onClick();
      }}
      className={`mb-1 flex w-full cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-left transition ${
        active ? 'border-signal/50 bg-signal/10' : 'border-transparent bg-ink-700/50 hover:bg-ink-700'
      }`}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-white/85">{title}</span>
        {subtitle && <span className="block truncate font-mono text-[11px] text-white/70">{subtitle}</span>}
      </span>
      {badge && (
        <span className="shrink-0 rounded bg-ink-600 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-white/70">
          {badge}
        </span>
      )}
      {trailing}
    </div>
  );
}

export default function Inspector() {
  const t = useT();
  const scene = useStore((s) => s.scene);
  const solve = useStore((s) => s.solve);
  const warnings = useStore((s) => s.warnings);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const patchCamera = useStore((s) => s.patchCamera);
  const patchScene = useStore((s) => s.patchScene);
  const rawResponse = useStore((s) => s.rawResponse);
  const [showRaw, setShowRaw] = useState(false);

  if (!scene || !solve) return null;
  const cam = scene.camera;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-l border-ink-600 bg-ink-800">
      <Section title={t('inspector.camera')}>
        <Field label={t('inspector.rig')}>
          <select
            value={cam.rig}
            onChange={(e) => patchCamera({ rig: e.target.value })}
            className="w-full rounded border border-ink-500 bg-ink-700 px-2 py-1.5 text-[12px] text-white outline-none focus:border-signal/50"
          >
            {CAMERA_RIGS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('inspector.lens')} value={`${cam.lens} mm`}>
          <input
            type="range"
            min="12"
            max="135"
            step="1"
            value={cam.lens}
            onChange={(e) => patchCamera({ lens: Number(e.target.value) })}
            className="w-full"
          />
        </Field>

        <Field label={t('inspector.height')} value={`${cam.height.toFixed(2)} m`}>
          <input
            type="range"
            min="0.3"
            max="6"
            step="0.05"
            value={cam.height}
            onChange={(e) => patchCamera({ height: Number(e.target.value) })}
            className="w-full"
          />
        </Field>

        <Field label={t('inspector.distance')} value={`${cam.distance.toFixed(2)} m`}>
          <input
            type="range"
            min="0.4"
            max="12"
            step="0.1"
            value={cam.distance}
            onChange={(e) => patchCamera({ distance: Number(e.target.value) })}
            className="w-full"
          />
        </Field>

        <Field label={t('inspector.target')}>
          <select
            value={cam.target || ''}
            onChange={(e) => patchCamera({ target: e.target.value })}
            className="w-full rounded border border-ink-500 bg-ink-700 px-2 py-1.5 text-[12px] text-white outline-none focus:border-signal/50"
          >
            {scene.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>

        {cam.keys && (
          <p className="mt-1 rounded border border-ok/30 bg-ok/10 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ok/90">
            {t('inspector.keysActive', { n: cam.keys.length })}
          </p>
        )}
      </Section>

      <Section title={t('inspector.take')} defaultOpen={false}>
        <Field label={t('inspector.duration')} value={`${scene.project.duration} s`}>
          <input
            type="range"
            min="4"
            max="30"
            step="1"
            value={scene.project.duration}
            onChange={(e) =>
              patchScene({ project: { ...scene.project, duration: Number(e.target.value) } })
            }
            className="w-full"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('inspector.fps')}>
            <select
              value={scene.project.fps}
              onChange={(e) => patchScene({ project: { ...scene.project, fps: Number(e.target.value) } })}
              className="w-full rounded border border-ink-500 bg-ink-700 px-2 py-1.5 text-[12px] text-white outline-none focus:border-signal/50"
            >
              {[12, 24, 25, 30, 50, 60].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('inspector.aspect')}>
            <select
              value={scene.project.aspectRatio}
              onChange={(e) =>
                patchScene({ project: { ...scene.project, aspectRatio: e.target.value } })
              }
              className="w-full rounded border border-ink-500 bg-ink-700 px-2 py-1.5 text-[12px] text-white outline-none focus:border-signal/50"
            >
              {['16:9', '9:16', '1:1', '4:5', '2.39:1'].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title={t('inspector.actors', { n: scene.actors.length })}>
        {scene.actors.map((a) => {
          const entry = solve.actorPaths.get(a.id);
          const speed = entry?.speed ?? 0;
          const odd = speed > HUMAN_SPEED.max || speed < HUMAN_SPEED.min;
          return (
            <Row
              key={a.id}
              active={selection?.kind === 'actor' && selection.id === a.id}
              color={a.color}
              title={a.name}
              subtitle={`${entry?.path.length.toFixed(1) ?? 0} m — ${speed.toFixed(2)} m/s${odd ? ' (!)' : ''}`}
              badge={TYPE_LABELS[inferActorType(a)]}
              testId={`row-${a.id}`}
              onClick={() => select({ kind: 'actor', id: a.id })}
              trailing={<RefThumb entityId={a.id} entityName={a.name} />}
            />
          );
        })}
        {/* Chaque ligne porte deja sa vignette (RefThumb) ; le panneau complet
            — retrait, URL manuelle — ne s'affiche que sous l'element selectionne. */}
        {selection?.kind === 'actor' && (
          <RefImage
            entityId={selection.id}
            entityName={scene.actors.find((a) => a.id === selection.id)?.name || ''}
          />
        )}
      </Section>

      {scene.props?.length > 0 && (
        <Section title={t('inspector.props', { n: scene.props.length })}>
          {scene.props.map((p) => (
            <Row
              key={p.id}
              active={selection?.kind === 'prop' && selection.id === p.id}
              color={p.color}
              title={p.name}
              subtitle={scene.zones.find((z) => z.id === p.zone)?.name}
              badge={TYPE_LABELS[inferType(p, 'generic')]}
              testId={`row-${p.id}`}
              onClick={() => select({ kind: 'prop', id: p.id })}
              trailing={<RefThumb entityId={p.id} entityName={p.name} />}
            />
          ))}
          {selection?.kind === 'prop' && (
            <RefImage
              entityId={selection.id}
              entityName={scene.props.find((p) => p.id === selection.id)?.name || ''}
            />
          )}
        </Section>
      )}

      <Section title={t('inspector.zones', { n: scene.zones.length })} defaultOpen={false}>
        {scene.zones.map((z) => (
          <Row
            key={z.id}
            active={selection?.kind === 'zone' && selection.id === z.id}
            color={z.color}
            title={z.name}
            subtitle={`${z.width} x ${z.depth} m`}
            onClick={() => select({ kind: 'zone', id: z.id })}
            trailing={<RefThumb entityId={z.id} entityName={z.name} />}
          />
        ))}
        {selection?.kind === 'zone' && (
          <RefImage
            entityId={selection.id}
            entityName={scene.zones.find((z) => z.id === selection.id)?.name || ''}
          />
        )}
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-white/70">
          {solve.graph.doorways.length
            ? t('inspector.doorways', {
                n: solve.graph.doorways.length,
                names: solve.graph.doorways.map((d) => d.name).join(', '),
              })
            : t('inspector.doorways.none')}
        </p>
      </Section>

      {warnings.length > 0 && (
        <Section title={t('inspector.warnings', { n: warnings.length })} defaultOpen={false} tone="text-amber-200/85">
          <ul className="space-y-1.5">
            {warnings.map((w, i) => (
              <li
                key={i}
                className="rounded border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 text-[12px] leading-relaxed text-amber-200/80"
              >
                {w}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Tout ce qui s'adresse a un directeur technique plutot qu'a un chef
          operateur vit ici, replie par defaut. */}
      <Section title={t('inspector.advanced')} defaultOpen={false} tone="text-white/55">
        <ModelPanel />
        {rawResponse && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              aria-expanded={showRaw}
              className="py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/70 underline underline-offset-2 transition-colors hover:text-white"
            >
              {showRaw ? t('inspector.raw.hide') : t('inspector.raw.show')}
            </button>
            {showRaw && (
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-white/80">
                {JSON.stringify(rawResponse, null, 2)}
              </pre>
            )}
          </div>
        )}
      </Section>
    </aside>
  );
}
