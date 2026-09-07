import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Line, Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Vector3 } from 'three';
import { useStore } from '../store/useStore.js';
import { samplePathAtT } from '../scene/paths.js';
import { cameraAtTime } from '../scene/camera.js';
import Proxy from '../proxies/Proxies.jsx';
import SceneEditing from './SceneEditing.jsx';
import EditToolbar from './EditToolbar.jsx';
import ScenePrompt from './ScenePrompt.jsx';
import { useT } from '../i18n/index.js';
import AIModel from '../proxies/AIModel.jsx';
import { inferActorType, inferType, propBounds, PROXY_BOUNDS } from '../proxies/registry.js';

// Horloge unique de l'application. La 3D et la timeline lisent le meme `time`
// du store : elles ne peuvent pas se desynchroniser.
function Clock() {
  const advance = useStore((s) => s.advance);
  useFrame((_, delta) => advance(Math.min(delta, 0.1)));
  return null;
}

const boxCenter = (c) => [
  (c.min[0] + c.max[0]) / 2,
  (c.min[1] + c.max[1]) / 2,
  (c.min[2] + c.max[2]) / 2,
];
const boxSize = (c) => [c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]];

/** Sols des pieces. */
function ZoneFloors({ zones, selection, onSelect, labels, plan }) {
  return (
    <group>
      {zones.map((z) => {
        const active = selection?.kind === 'zone' && selection.id === z.id;
        return (
          <group key={z.id}>
            <mesh
              position={[z.position[0], z.position[1] + 0.01, z.position[2]]}
              rotation={[-Math.PI / 2, 0, 0]}
              receiveShadow
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ kind: 'zone', id: z.id });
              }}
            >
              <planeGeometry args={[z.width, z.depth]} />
              <meshStandardMaterial
                color={z.color}
                roughness={0.95}
                emissive={active ? '#F27D26' : '#000000'}
                emissiveIntensity={active ? 0.18 : 0}
              />
            </mesh>
            {labels && (
              <Html
                position={[z.position[0], z.position[1] + 0.05, z.position[2]]}
                center
                distanceFactor={plan ? undefined : 22}
                zIndexRange={[10, 0]}
              >
                <div
                  data-testid="zone-label"
                  className="pointer-events-none select-none whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.18em] text-white/55"
                >
                  {z.name}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/**
 * Murs, linteaux et montants. Ils sont rendus directement depuis les volumes de
 * collision : ce que l'on voit est exactement ce qui bloque la camera, il ne
 * peut pas y avoir de desaccord entre le visuel et la detection.
 */
function SetGeometry({ colliders, highlightNames }) {
  return (
    <group>
      {colliders
        .filter((c) => c.kind !== 'prop')
        .map((c) => {
          const flagged = highlightNames.has(c.name);
          const isDoor = c.kind === 'doorframe';
          return (
            <mesh key={c.id} position={boxCenter(c)} castShadow receiveShadow>
              <boxGeometry args={boxSize(c)} />
              <meshStandardMaterial
                color={flagged ? '#ff3b30' : isDoor ? '#5A5F68' : '#31353D'}
                transparent
                opacity={flagged ? 0.85 : isDoor ? 0.9 : 0.55}
                roughness={0.9}
                emissive={flagged ? '#ff3b30' : '#000000'}
                emissiveIntensity={flagged ? 0.4 : 0}
              />
            </mesh>
          );
        })}
    </group>
  );
}

/**
 * Un element porte soit un modele ecrit par GPT-6 Astra, soit le proxy
 * procedural. Le modele IA est prioritaire, mais s'il ne compile pas on retombe
 * sur le proxy : un blocking ne doit jamais perdre un element a cause d'une
 * generation ratee.
 */
function Body({ model, type, color, height, scale, selected, bounds }) {
  const proxy = (
    <Proxy type={type} color={color} height={height} scale={scale} selected={selected} bounds={bounds} />
  );
  if (!model) return proxy;
  return (
    <>
      <AIModel source={model} color={color} bounds={bounds} fallback={proxy} />
      {selected && (
        <mesh position={[0, bounds.height / 2, 0]}>
          <boxGeometry args={[bounds.width * 1.25 + 0.2, bounds.height * 1.1 + 0.2, bounds.depth * 1.25 + 0.2]} />
          <meshBasicMaterial color="#F27D26" wireframe transparent opacity={0.55} />
        </mesh>
      )}
    </>
  );
}

function Actors({ scene, solve, time, selection, onSelect, labels, plan, models }) {
  const t01 = scene.project.duration > 0 ? time / scene.project.duration : 0;
  return (
    <group>
      {scene.actors.map((actor) => {
        const entry = solve.actorPaths.get(actor.id);
        if (!entry) return null;
        const { position, tangent } = samplePathAtT(entry.path, t01);
        const yaw = Math.atan2(tangent.x, tangent.z);
        const selected = selection?.kind === 'actor' && selection.id === actor.id;
        const type = inferActorType(actor);
        return (
          <group
            key={actor.id}
            position={[position.x, 0, position.z]}
            rotation={[0, yaw, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect({ kind: 'actor', id: actor.id });
            }}
          >
            <Body
              model={models?.[actor.id]?.three}
              type={type}
              color={actor.color}
              height={actor.height}
              selected={selected}
              bounds={{ ...PROXY_BOUNDS[type], height: actor.height }}
            />
            {labels && (
              <Html
                position={[0, actor.height + 0.34, 0]}
                center
                distanceFactor={plan ? undefined : 16}
                zIndexRange={[20, 0]}
              >
                <div className="pointer-events-none select-none whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-white/80">
                  {actor.name}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

function Props({ props, selection, onSelect, labels, plan, models }) {
  return (
    <group>
      {(props || []).map((prop) => {
        const bounds = propBounds(prop);
        const selected = selection?.kind === 'prop' && selection.id === prop.id;
        return (
          <group
            key={prop.id}
            position={[prop.position[0], 0, prop.position[2]]}
            rotation={[0, prop.rotation || 0, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect({ kind: 'prop', id: prop.id });
            }}
          >
            <Body
              model={models?.[prop.id]?.three}
              type={inferType(prop, 'generic')}
              color={prop.color}
              scale={prop.scale || 1}
              selected={selected}
              bounds={bounds}
            />
            {labels && (
              <Html
                position={[0, bounds.height + 0.3, 0]}
                center
                distanceFactor={plan ? undefined : 18}
                zIndexRange={[20, 0]}
              >
                <div className="pointer-events-none select-none whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-white/80">
                  {prop.name}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** Trajectoires : acteurs en pointille clair, camera en ruban vert (rouge en contact). */
function Trajectories({ scene, solve }) {
  const segments = useMemo(() => {
    const pos = solve.track.positions;
    const colliding = solve.collision.collidingFrames;
    const runs = [];
    let current = null;
    pos.forEach((p, i) => {
      const bad = colliding.has(i);
      if (!current || current.bad !== bad) {
        // On prolonge d'un point pour que les segments se rejoignent visuellement.
        if (current) current.points.push([p.x, p.y, p.z]);
        current = { bad, points: [[p.x, p.y, p.z]] };
        runs.push(current);
      } else {
        current.points.push([p.x, p.y, p.z]);
      }
    });
    return runs.filter((r) => r.points.length > 1);
  }, [solve]);

  return (
    <group>
      {scene.actors.map((actor) => {
        const entry = solve.actorPaths.get(actor.id);
        if (!entry || entry.path.degenerate) return null;
        const pts = entry.path.samples.filter((_, i) => i % 6 === 0).map((p) => [p.x, 0.04, p.z]);
        return (
          <Line
            key={actor.id}
            points={pts}
            color={actor.color}
            lineWidth={1.4}
            transparent
            opacity={0.42}
            dashed
            dashSize={0.35}
            gapSize={0.25}
          />
        );
      })}
      {segments.map((run, i) => (
        <Line
          key={i}
          points={run.points}
          color={run.bad ? '#ff3b30' : '#38d17a'}
          lineWidth={run.bad ? 3.4 : 1.9}
          transparent
          opacity={run.bad ? 1 : 0.75}
        />
      ))}
    </group>
  );
}

/** Repere de la camera de scene, visible seulement en mode Orbite. */
function CameraGizmo({ track, time, fov }) {
  const { position, lookAt } = useMemo(() => cameraAtTime(track, time), [track, time]);
  const forward = lookAt.clone().sub(position).normalize();
  const yaw = Math.atan2(forward.x, forward.z);
  const pitch = Math.asin(-forward.y);
  const depth = 2.2;
  const halfH = Math.tan((fov * Math.PI) / 360) * depth;
  const halfW = halfH * (16 / 9);

  return (
    <group position={[position.x, position.y, position.z]} rotation={[pitch, yaw, 0, 'YXZ']}>
      <mesh>
        <boxGeometry args={[0.3, 0.22, 0.42]} />
        <meshStandardMaterial color="#e8eaed" flatShading />
      </mesh>
      {[
        [halfW, halfH],
        [-halfW, halfH],
        [halfW, -halfH],
        [-halfW, -halfH],
      ].map(([x, y], i) => (
        <Line key={i} points={[[0, 0, 0], [x, y, depth]]} color="#38d17a" lineWidth={1} transparent opacity={0.5} />
      ))}
      <Line
        points={[
          [-halfW, -halfH, depth],
          [halfW, -halfH, depth],
          [halfW, halfH, depth],
          [-halfW, halfH, depth],
          [-halfW, -halfH, depth],
        ]}
        color="#38d17a"
        lineWidth={1.2}
        transparent
        opacity={0.7}
      />
    </group>
  );
}

/** Pilote la camera de rendu en mode Realisateur. */
function DirectorCamera({ track, fov }) {
  const ref = useRef();
  const time = useStore((s) => s.time);
  const { size } = useThree();

  useEffect(() => {
    if (!ref.current) return;
    ref.current.fov = fov;
    ref.current.updateProjectionMatrix();
  }, [fov, size]);

  useFrame(() => {
    if (!ref.current) return;
    const { position, lookAt } = cameraAtTime(track, useStore.getState().time);
    ref.current.position.copy(position);
    ref.current.lookAt(lookAt);
  });

  // La position initiale evite une image parasite avant le premier useFrame.
  const initial = cameraAtTime(track, time);
  return <PerspectiveCamera ref={ref} makeDefault fov={fov} near={0.05} far={400} position={initial.position} />;
}

/** Bornes au sol de la scene, marge comprise. */
function sceneBounds(zones, margin = 3) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const z of zones) {
    b.minX = Math.min(b.minX, z.position[0] - z.width / 2);
    b.maxX = Math.max(b.maxX, z.position[0] + z.width / 2);
    b.minZ = Math.min(b.minZ, z.position[2] - z.depth / 2);
    b.maxZ = Math.max(b.maxZ, z.position[2] + z.depth / 2);
  }
  return {
    centerX: (b.minX + b.maxX) / 2,
    centerZ: (b.minZ + b.maxZ) / 2,
    spanX: b.maxX - b.minX + margin * 2,
    spanZ: b.maxZ - b.minZ + margin * 2,
  };
}

/**
 * Vue plan : camera orthographique a la verticale, cadree sur le decor. C'est
 * le plan de masse du realisateur, anime par la meme horloge que le reste.
 */
function PlanCamera({ scene }) {
  const ref = useRef();
  const { size } = useThree();
  const b = useMemo(() => sceneBounds(scene.zones), [scene]);
  // Zoom orthographique : pixels par metre, borne par l'axe le plus contraignant
  // pour que tout le decor tienne dans le cadre.
  const zoom = Math.min(size.width / b.spanX, size.height / b.spanZ);

  // Orientation posee imperativement : passer `rotation` et `up` en props a une
  // camera se contredit, la matrice n'est pas recalculee dans le bon ordre.
  useEffect(() => {
    const cam = ref.current;
    if (!cam) return;
    cam.position.set(b.centerX, 100, b.centerZ);
    cam.up.set(0, 0, -1); // -Z pointe vers le haut de l'ecran, comme un plan de masse
    cam.lookAt(b.centerX, 0, b.centerZ);
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
  }, [b, zoom]);

  return <OrthographicCamera ref={ref} makeDefault near={0.1} far={400} />;
}

function OrbitCamera({ scene }) {
  const center = useMemo(() => {
    const zs = scene.zones;
    const c = zs.reduce((acc, z) => acc.add(new Vector3(z.position[0], 0, z.position[2])), new Vector3());
    return c.divideScalar(Math.max(1, zs.length));
  }, [scene]);

  const span = useMemo(() => {
    let max = 12;
    for (const z of scene.zones) {
      max = Math.max(max, Math.abs(z.position[0]) + z.width, Math.abs(z.position[2]) + z.depth);
    }
    return max;
  }, [scene]);

  return (
    <>
      <PerspectiveCamera
        makeDefault
        fov={48}
        near={0.1}
        far={1200}
        position={[center.x + span * 0.75, span * 0.85, center.z + span * 1.05]}
      />
      <OrbitControls target={[center.x, 1, center.z]} enableDamping dampingFactor={0.09} makeDefault />
    </>
  );
}

function SceneContents({ capture = false }) {
  const scene = useStore((s) => s.scene);
  const solve = useStore((s) => s.solve);
  const time = useStore((s) => s.time);
  const viewMode = useStore((s) => s.viewMode);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);

  // Le surlignage rouge des collisions est un diagnostic d'interface. Il sort du
  // cadre pendant l'enregistrement : un modele video le lirait comme un parti
  // pris d'eclairage plutot que comme une alerte.
  const highlightNames = useMemo(() => {
    if (capture || !solve?.collision.obstacles.length) return new Set();
    return new Set(solve.collision.obstacles.map((o) => o.name));
  }, [solve, capture]);

  if (!scene || !solve) return null;
  const isOrbit = viewMode === 'orbit';
  const isPlan = viewMode === 'plan';
  // Etiquettes, trajectoires et repere camera : utiles pour analyser le
  // blocking, parasites dans le cadre du realisateur.
  const overlays = isOrbit || isPlan;

  return (
    <>
      <Clock />
      {isOrbit && <OrbitCamera scene={scene} />}
      {isPlan && <PlanCamera scene={scene} />}
      {!overlays && <DirectorCamera track={solve.track} fov={solve.track.fov} />}

      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#8fa3bd', '#1b1d22', 0.7]} />
      <directionalLight position={[14, 22, 10]} intensity={1.05} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-16, 12, -14]} intensity={0.35} color="#7FA5C7" />

      {!isPlan && (
        <Grid
          infiniteGrid
          cellSize={1}
          sectionSize={5}
          cellColor="#22262d"
          sectionColor="#333a45"
          fadeDistance={95}
          fadeStrength={1.6}
          position={[0, -0.002, 0]}
        />
      )}

      <ZoneFloors zones={scene.zones} selection={selection} onSelect={select} labels={overlays} plan={isPlan} />
      <SetGeometry colliders={solve.colliders} highlightNames={highlightNames} />
      <Props
        props={scene.props}
        selection={selection}
        onSelect={select}
        labels={overlays}
        plan={isPlan}
        models={scene.models}
      />
      <Actors
        scene={scene}
        solve={solve}
        time={time}
        selection={selection}
        onSelect={select}
        labels={overlays}
        plan={isPlan}
        models={scene.models}
      />
      {overlays && <SceneEditing />}
      {overlays && (
        <>
          <Trajectories scene={scene} solve={solve} />
          <CameraGizmo track={solve.track} time={time} fov={solve.track.fov} />
        </>
      )}
    </>
  );
}

/** Cache letterbox au format demande, dessine en DOM pour rester net. */
function AspectMask({ ratio }) {
  const [w, h] = useMemo(() => {
    const m = String(ratio).match(/(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)/i);
    return m ? [Number(m[1]), Number(m[2])] : [16, 9];
  }, [ratio]);

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className="relative border border-white/15 shadow-[0_0_0_9999px_rgba(6,7,9,0.72)]"
        style={{ aspectRatio: `${w} / ${h}`, maxWidth: '100%', maxHeight: '100%', width: '100%' }}
      >
        {/* Zone de securite centrale 4:5, pour les recadrages verticaux. */}
        <div
          className="absolute top-0 h-full border-x border-dashed border-white/10"
          style={{ left: '50%', transform: 'translateX(-50%)', aspectRatio: '4 / 5' }}
        />
        {[
          'left-0 top-0 border-l-2 border-t-2',
          'right-0 top-0 border-r-2 border-t-2',
          'left-0 bottom-0 border-l-2 border-b-2',
          'right-0 bottom-0 border-r-2 border-b-2',
        ].map((cls) => (
          <div key={cls} className={`absolute h-4 w-4 border-white/40 ${cls}`} />
        ))}
      </div>
    </div>
  );
}

/**
 * Bascule de vue. Elle vivait dans le header, ou elle disputait sa place a la
 * navigation du pipeline ; c'est une commande du viewport, elle se pose dessus.
 */
const VIEW_MODES = [
  { id: 'director', label: 'view.camera', hint: 'view.camera.hint' },
  { id: 'plan', label: 'view.top', hint: 'view.top.hint' },
  { id: 'orbit', label: 'view.orbit', hint: 'view.orbit.hint' },
];

function ViewModeControl() {
  const t = useT();
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  return (
    <div
      role="group"
      aria-label={t('view.mode')}
      className="pointer-events-auto flex rounded border border-ink-500 bg-ink-800/90 p-0.5 backdrop-blur"
    >
      {VIEW_MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          data-testid={`view-${m.id}`}
          onClick={() => setViewMode(m.id)}
          title={t(m.hint)}
          aria-pressed={viewMode === m.id}
          className={`rounded px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors duration-150 ${
            viewMode === m.id ? 'bg-signal/20 text-signal' : 'text-white/70 hover:text-white'
          }`}
        >
          {t(m.label)}
        </button>
      ))}
    </div>
  );
}

/**
 * @param {{ dpr?: number|number[], capture?: boolean }} props
 * `capture` sert l'enregistrement video : le cache de format est un calque DOM,
 * il n'entre pas dans le flux du canvas, et on le retire pour que l'apercu
 * corresponde exactement a ce qui est enregistre.
 */
export default function Viewport({ dpr = [1, 2], capture = false }) {
  const scene = useStore((s) => s.scene);
  const viewMode = useStore((s) => s.viewMode);
  const select = useStore((s) => s.select);

  return (
    <div className="relative h-full w-full bg-ink-900">
      <Canvas
        shadows
        dpr={dpr}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => select(null)}
      >
        <color attach="background" args={['#0c0d10']} />
        {viewMode !== 'plan' && <fog attach="fog" args={['#0c0d10', 40, 150]} />}
        <SceneContents capture={capture} />
      </Canvas>
      {!capture && viewMode === 'director' && scene && <AspectMask ratio={scene.project.aspectRatio} />}
      {!capture && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] flex-col gap-2 overflow-y-auto">
          <ViewModeControl />
          <EditToolbar />
          <ScenePrompt />
        </div>
      )}
    </div>
  );
}
