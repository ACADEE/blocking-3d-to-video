import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Line, TransformControls } from '@react-three/drei';
import { Vector3 } from 'three';
import { useStore } from '../store/useStore.js';
import { propBounds, inferActorType, PROXY_BOUNDS } from '../proxies/registry.js';

// Edition directe dans le viewport.
//
// Trois gestes, un seul principe : on edite la DEFINITION de la scene, puis on
// la resout a nouveau. Rien n'est jamais ecrit dans le rendu. La scene reste
// une fonction pure du temps, donc la lecture et le scrub continuent d'etre
// exacts pendant qu'on deplace des choses.
//
// Le recalcul n'a lieu qu'au relachement du gizmo, pas a chaque image du
// glisse : deplacer une zone reconstruit le graphe de portes et les itineraires
// de tout le monde.

const HANDLE_RADIUS = 0.22;

/** Gizmo attache a un objet ou une zone. */
function EntityGizmo({ kind, id, position, rotation, mode, onCommit }) {
  const ref = useRef();
  const controls = useRef();

  useEffect(() => {
    const c = controls.current;
    if (!c) return undefined;
    // On ne valide qu'au relachement : recalculer la scene a chaque image du
    // glisse reconstruirait le graphe de portes et tous les itineraires.
    // La mise en pause de l'orbite pendant le glisse est deja assuree par drei.
    const onDragging = (e) => {
      if (!e.value && ref.current) {
        onCommit(ref.current.position.toArray(), ref.current.rotation.y);
      }
    };
    c.addEventListener('dragging-changed', onDragging);
    return () => c.removeEventListener('dragging-changed', onDragging);
  }, [onCommit]);

  return (
    <TransformControls
      ref={controls}
      mode={mode === 'rotate' ? 'rotate' : 'translate'}
      showY={false}
      showX={mode !== 'rotate'}
      showZ={mode !== 'rotate'}
      size={0.7}
      onObjectChange={() => {}}
    >
      <group ref={ref} position={position} rotation={[0, rotation || 0, 0]}>
        <mesh visible={false}>
          <boxGeometry args={[0.4, 0.4, 0.4]} />
        </mesh>
      </group>
    </TransformControls>
  );
}

/**
 * Poignees de trajectoire.
 *
 * Une trajectoire calculee n'a pas de points a deplacer : il faut d'abord la
 * figer en waypoints explicites, ce que fait "Editer la trajectoire". C'est le
 * seul etat depuis lequel l'edition a un sens.
 */
function PathHandles({ actor, selectedIndex, onSelectPoint, onMovePoint, onInsert }) {
  const points = actor.waypoints || [];
  const line = useMemo(() => points.map((p) => [p[0], 0.05, p[2]]), [points]);

  return (
    <group>
      {line.length >= 2 && (
        <Line
          points={line}
          color={actor.color}
          lineWidth={2.5}
          transparent
          opacity={0.8}
          onClick={(e) => {
            e.stopPropagation();
            // Insertion au segment le plus proche du clic : on garde l'ordre.
            const p = e.point;
            let best = 1;
            let bestDist = Infinity;
            for (let i = 1; i < points.length; i += 1) {
              const a = new Vector3(points[i - 1][0], 0, points[i - 1][2]);
              const b = new Vector3(points[i][0], 0, points[i][2]);
              const mid = a.clone().add(b).multiplyScalar(0.5);
              const d = mid.distanceTo(new Vector3(p.x, 0, p.z));
              if (d < bestDist) {
                bestDist = d;
                best = i;
              }
            }
            onInsert(best, [p.x, 0, p.z]);
          }}
        />
      )}

      {points.map((p, i) => (
        <mesh
          key={i}
          position={[p[0], 0.05, p[2]]}
          onClick={(e) => {
            e.stopPropagation();
            onSelectPoint(i);
          }}
        >
          <sphereGeometry args={[HANDLE_RADIUS, 14, 10]} />
          <meshBasicMaterial color={i === selectedIndex ? '#ffffff' : actor.color} />
        </mesh>
      ))}

      {selectedIndex != null && points[selectedIndex] && (
        <MovableHandle
          position={[points[selectedIndex][0], 0.05, points[selectedIndex][2]]}
          onCommit={(pos) => onMovePoint(selectedIndex, pos)}
        />
      )}
    </group>
  );
}

function MovableHandle({ position, onCommit, showY = false }) {
  const ref = useRef();
  const controls = useRef();

  useEffect(() => {
    const c = controls.current;
    if (!c) return undefined;
    const onDragging = (e) => {
      if (!e.value && ref.current) onCommit(ref.current.position.toArray());
    };
    c.addEventListener('dragging-changed', onDragging);
    return () => c.removeEventListener('dragging-changed', onDragging);
  }, [onCommit]);

  return (
    <TransformControls ref={controls} mode="translate" showY={showY} size={0.6}>
      <group ref={ref} position={position}>
        <mesh visible={false}>
          <boxGeometry args={[0.2, 0.2, 0.2]} />
        </mesh>
      </group>
    </TransformControls>
  );
}

/**
 * Poignees de la trajectoire camera.
 *
 * Meme principe que PathHandles : le ruban vert affiche les cles, un clic
 * dessus insere une cle a mi-chemin des deux voisines, un clic sur une cle la
 * selectionne et fait apparaitre une poignee qu'on peut etirer (y compris en
 * hauteur, contrairement aux points de trajectoire au sol).
 */
function CameraKeyHandles({ keys, selectedT, onSelectKey, onMoveKey, onInsert }) {
  const line = useMemo(() => (keys || []).map((k) => k.position), [keys]);
  if (!keys?.length) return null;
  const selected = keys.find((k) => Math.abs(k.t - selectedT) < 1e-3);

  return (
    <group>
      {line.length >= 2 && (
        <Line
          points={line}
          color="#38d17a"
          lineWidth={2.5}
          transparent
          opacity={0.8}
          onClick={(e) => {
            e.stopPropagation();
            const p = e.point;
            let best = 1;
            let bestDist = Infinity;
            for (let i = 1; i < keys.length; i += 1) {
              const a = new Vector3(...keys[i - 1].position);
              const b = new Vector3(...keys[i].position);
              const mid = a.clone().add(b).multiplyScalar(0.5);
              const d = mid.distanceTo(new Vector3(p.x, p.y, p.z));
              if (d < bestDist) {
                bestDist = d;
                best = i;
              }
            }
            onInsert(keys[best - 1].t, [p.x, p.y, p.z]);
          }}
        />
      )}

      {keys.map((k) => (
        <mesh
          key={k.t}
          position={k.position}
          onClick={(e) => {
            e.stopPropagation();
            onSelectKey(k.t);
          }}
        >
          <octahedronGeometry args={[0.16]} />
          <meshBasicMaterial color={Math.abs(k.t - selectedT) < 1e-3 ? '#ffffff' : '#38d17a'} />
        </mesh>
      ))}

      {selected && (
        <MovableHandle position={selected.position} showY onCommit={(pos) => onMoveKey(selected.t, pos)} />
      )}
    </group>
  );
}

export default function SceneEditing() {
  const scene = useStore((s) => s.scene);
  const solve = useStore((s) => s.solve);
  const selection = useStore((s) => s.selection);
  const editMode = useStore((s) => s.editMode);
  const viewMode = useStore((s) => s.viewMode);
  const moveEntity = useStore((s) => s.moveEntity);
  const setActorPath = useStore((s) => s.setActorPath);
  const insertActorWaypoint = useStore((s) => s.insertActorWaypoint);
  const removeActorWaypoint = useStore((s) => s.removeActorWaypoint);
  const moveCameraKey = useStore((s) => s.moveCameraKey);
  const insertCameraKeyAfter = useStore((s) => s.insertCameraKeyAfter);
  const removeCameraKey = useStore((s) => s.removeCameraKey);
  const [pointIndex, setPointIndex] = useState(null);
  const [cameraKeyT, setCameraKeyT] = useState(null);

  useEffect(() => setPointIndex(null), [selection?.id]);

  // Suppression d'un point de trajectoire au clavier.
  useEffect(() => {
    if (pointIndex == null || selection?.kind !== 'actor') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      removeActorWaypoint(selection.id, pointIndex);
      setPointIndex(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pointIndex, selection, removeActorWaypoint]);

  // Suppression d'une cle camera au clavier, meme geste que pour un point de trajectoire.
  useEffect(() => {
    if (cameraKeyT == null) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      removeCameraKey(cameraKeyT);
      setCameraKeyT(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cameraKeyT, removeCameraKey]);

  if (!scene || !solve || editMode === 'off' || viewMode === 'director') return null;

  const actor =
    selection?.kind === 'actor' ? scene.actors.find((a) => a.id === selection.id) : null;
  const prop = selection?.kind === 'prop' ? scene.props.find((p) => p.id === selection.id) : null;
  const zone = selection?.kind === 'zone' ? scene.zones.find((z) => z.id === selection.id) : null;

  return (
    <group>
      <CameraKeyHandles
        keys={scene.camera.keys}
        selectedT={cameraKeyT}
        onSelectKey={(t) => {
          setPointIndex(null);
          setCameraKeyT(t);
        }}
        onMoveKey={(t, pos) => moveCameraKey(t, pos)}
        onInsert={(afterT, pos) => insertCameraKeyAfter(afterT, pos)}
      />

      {prop && editMode !== 'select' && (
        <EntityGizmo
          kind="prop"
          id={prop.id}
          position={[prop.position[0], propBounds(prop).height / 2, prop.position[2]]}
          rotation={prop.rotation}
          mode={editMode}
          onCommit={(pos, rot) => moveEntity('prop', prop.id, pos, rot)}
        />
      )}

      {zone && editMode !== 'select' && (
        <EntityGizmo
          kind="zone"
          id={zone.id}
          position={[zone.position[0], 0.4, zone.position[2]]}
          rotation={0}
          mode="translate"
          onCommit={(pos) => moveEntity('zone', zone.id, pos)}
        />
      )}

      {actor?.waypoints && (
        <PathHandles
          actor={actor}
          selectedIndex={pointIndex}
          onSelectPoint={(i) => {
            setCameraKeyT(null);
            setPointIndex(i);
          }}
          onMovePoint={(i, pos) => {
            const next = actor.waypoints.map((w, j) => (j === i ? [pos[0], 0, pos[2]] : w));
            setActorPath(actor.id, next);
          }}
          onInsert={(i, pos) => {
            insertActorWaypoint(actor.id, i, pos);
            setPointIndex(i);
          }}
        />
      )}

      {actor && !actor.waypoints && (
        // Silhouette du trajet calcule : elle montre ce qui sera fige si on
        // choisit de l'editer.
        <Line
          points={solve.actorPaths
            .get(actor.id)
            .path.samples.filter((_, i) => i % 8 === 0)
            .map((p) => [p.x, 0.05, p.z])}
          color={actor.color}
          lineWidth={2}
          transparent
          opacity={0.55}
          dashed
          dashSize={0.4}
          gapSize={0.25}
        />
      )}
    </group>
  );
}

export { PROXY_BOUNDS, inferActorType };
