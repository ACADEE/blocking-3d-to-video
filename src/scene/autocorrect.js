import { Vector3 } from 'three';
import { CAMERA_RADIUS, clearanceAt, escapeVector, sweepCamera } from './collision.js';
import { solveCameraTrack, waypointsToKeys } from './camera.js';
import { solveScene } from './build.js';
import { normalizeSceneGraph } from './normalize.js';

// Correction locale de trajectoire camera.
//
// Sert de repli quand il n'y a pas de cle API, quand l'appel echoue, ou quand la
// proposition du modele reste en collision. Le principe est un relachement
// iteratif : on repousse les points fautifs hors des volumes, on recentre les
// passages sur les ouvertures, on relisse, et on recommence.

const MARGIN = 0.12; // degagement vise au-dela du rayon camera
const PASSES = 24;

function smooth(points, strength = 0.5) {
  const out = points.map((p) => p.clone());
  for (let i = 1; i < points.length - 1; i += 1) {
    const avg = points[i - 1].clone().add(points[i + 1]).multiplyScalar(0.5);
    out[i] = points[i].clone().lerp(avg, strength);
  }
  return out;
}

/**
 * Recentre sur l'ouverture les points qui s'en approchent : franchir une porte
 * hors de son axe est la premiere cause de collision d'encadrement.
 */
function snapToDoorways(points, doorways) {
  if (!doorways.length) return points;
  return points.map((p) => {
    for (const d of doorways) {
      const center = new Vector3(d.position[0], p.y, d.position[2]);
      const along = d.axis === 'z' ? Math.abs(p.z - center.z) : Math.abs(p.x - center.x);
      if (along > 1.4) continue;

      // Attraction laterale d'autant plus forte qu'on est dans l'embrasure.
      const pull = 1 - Math.min(1, along / 1.4);
      const q = p.clone();
      if (d.axis === 'z') q.x += (center.x - p.x) * pull * 0.85;
      else q.z += (center.z - p.z) * pull * 0.85;
      return q;
    }
    return p;
  });
}

/**
 * @param {Vector3[]} positions trajectoire camera image par image
 * @param {object[]} colliders volumes du decor
 * @param {object[]} doorways ouvertures disponibles
 * @param {number} height hauteur de rig a preserver
 * @returns {{ points: Vector3[], resolved: boolean, moved: number }}
 */
export function relaxTrajectory(positions, colliders, doorways, height, margin = MARGIN) {
  let points = positions.map((p) => p.clone());
  const original = positions.map((p) => p.clone());
  const target = CAMERA_RADIUS + margin;
  let resolved = false;

  for (let pass = 0; pass < PASSES; pass += 1) {
    let worst = 0;

    points = points.map((p) => {
      const { distance, collider } = clearanceAt(colliders, p);
      if (distance >= target || !collider) return p;

      worst = Math.max(worst, target - distance);
      const dir = escapeVector(collider, p);
      // Pas de deplacement borne : on preserve la continuite de la courbe
      // plutot que de projeter brutalement le point hors du volume.
      return p.clone().addScaledVector(dir, Math.min(0.35, target - distance + 0.05));
    });

    points = snapToDoorways(points, doorways);
    points = smooth(points, 0.42);
    points = points.map((p) => new Vector3(p.x, height, p.z));

    if (worst === 0) {
      resolved = true;
      break;
    }
  }

  // Verification finale apres le dernier lissage.
  if (!resolved) {
    resolved = points.every((p) => clearanceAt(colliders, p).distance >= CAMERA_RADIUS);
  }

  let moved = 0;
  points.forEach((p, i) => {
    moved = Math.max(moved, p.distanceTo(original[i]));
  });

  return { points, resolved, moved };
}

/** Reduit une polyligne dense en waypoints exploitables par le solveur. */
export function toWaypoints(points, count = 10) {
  if (points.length <= count) return points.map((p) => [p.x, p.y, p.z]);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.round((i / (count - 1)) * (points.length - 1));
    out.push(points[idx]);
  }
  return out.map((p) => [
    Number(p.x.toFixed(3)),
    Number(p.y.toFixed(3)),
    Number(p.z.toFixed(3)),
  ]);
}

/**
 * Verifie une proposition de waypoints dans la representation reellement
 * utilisee par le moteur : spline refittee puis rebalayage. Une polyligne dense
 * peut etre degagee et son echantillonnage en waypoints ne plus l'etre, donc on
 * ne se fie jamais au relachement seul.
 *
 * @returns {{ track: object, sweep: object }}
 */
export function evaluateWaypoints({ scene, actorPaths, colliders, waypoints }) {
  // On evalue dans la representation finale : des cles, comme le moteur les
  // consommera. Valider une polyligne qui ne sera jamais jouee telle quelle
  // etait le piege que la boucle fermee sert justement a eviter.
  const keys = waypointsToKeys(waypoints, scene.project.duration);
  const candidate = { ...scene, camera: { ...scene.camera, keys } };
  const track = solveCameraTrack(candidate, actorPaths);
  return { track, sweep: sweepCamera(track, colliders) };
}

/**
 * Correction locale complete, en boucle fermee.
 *
 * A chaque tentative on relache la trajectoire, on la reduit en waypoints, puis
 * on evalue le resultat reel. Si le contact persiste, on repart des positions
 * effectivement obtenues en densifiant les waypoints et en augmentant la marge :
 * la boucle converge donc sur ce que le moteur produira vraiment.
 *
 * @returns {{ waypoints: number[][], resolved: boolean, note: string, sweep: object, track: object }}
 */
export function localAutoCorrect({ scene, actorPaths, track, colliders, graph }) {
  const height = scene.camera.height;
  let positions = track.positions;
  let best = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const margin = MARGIN + attempt * 0.06;
    const density = 12 + attempt * 10;

    const relaxed = relaxTrajectory(positions, colliders, graph.doorways, height, margin);
    const waypoints = toWaypoints(relaxed.points, density);
    const { track: candidateTrack, sweep } = evaluateWaypoints({
      scene,
      actorPaths,
      colliders,
      waypoints,
    });

    const result = { waypoints, sweep, track: candidateTrack, moved: relaxed.moved, attempt };
    if (!best || sweep.hits.length < best.sweep.hits.length) best = result;

    if (!sweep.first) {
      return {
        ...result,
        resolved: true,
        note: `Trajectoire degagee en ${attempt + 1} passe${attempt ? 's' : ''} : ecart maximal ${relaxed.moved.toFixed(
          2
        )} m, passages recentres sur les ouvertures.`,
      };
    }

    // On repart de la trajectoire reellement produite, pas de la polyligne
    // theorique : c'est ce qui fait converger la boucle.
    positions = candidateTrack.positions;
  }

  return {
    ...best,
    resolved: false,
    note: `Correction partielle : ${best.sweep.hits.length} image${
      best.sweep.hits.length > 1 ? 's' : ''
    } encore en contact avec "${best.sweep.worst.obstacleName}". Le decor est probablement trop etroit pour ce rig : elargis le passage ou allonge la duree.`,
  };
}

/**
 * Variantes de rig essayees quand le seul relachement de trajectoire ne suffit
 * pas. Ordre volontaire : du moins intrusif au plus, pour que la premiere qui
 * degage soit aussi celle qui altere le moins la prise.
 *
 * Elles ne sont pas classees par intuition mais par degre de modification, parce
 * que le resultat n'est pas predictible : sur une meme scene, allonger a 18 s ne
 * degage pas alors que 24 s si, et reduire comme augmenter la distance degagent
 * toutes deux. Le nombre de contacts initial augmente meme dans des cas qui
 * finissent resolus. On essaie donc, on ne raisonne pas.
 */
const RIG_VARIANTS = [
  { key: 'distance-', label: 'distance au sujet reduite', apply: (s) => ({ distance: s.camera.distance * 0.6 }) },
  { key: 'distance+', label: 'distance au sujet augmentee', apply: (s) => ({ distance: s.camera.distance * 1.5 }) },
  { key: 'distance--', label: 'distance au sujet fortement reduite', apply: (s) => ({ distance: s.camera.distance * 0.4 }) },
  { key: 'duration+', label: 'prise allongee', duration: (d) => Math.round(d * 1.5) },
  { key: 'duration++', label: 'prise fortement allongee', duration: (d) => Math.round(d * 2) },
];

const describe = (variant, scene, next) => {
  if (variant.duration) {
    return `${variant.label} : ${scene.project.duration} s -> ${next.project.duration} s`;
  }
  return `${variant.label} : ${scene.camera.distance.toFixed(2)} m -> ${next.camera.distance.toFixed(2)} m`;
};

/**
 * Correction complete, en deux temps.
 *
 * 1. Relachement de la trajectoire seule : c'est la correction qui ne touche a
 *    rien d'autre, donc celle qu'on prefere toujours.
 * 2. Si le decor reste trop etroit pour ce rig, on essaie un petit nombre de
 *    variantes et on garde la premiere qui degage vraiment. Chaque essai est un
 *    calcul pur d'environ 100 ms, entierement deterministe.
 *
 * Le resultat n'est jamais applique s'il est moins bon que l'etat courant.
 *
 * @returns {{ applied: boolean, resolved: boolean, scene: object|null,
 *             hitsBefore: number, hitsAfter: number, note: string, change: string|null }}
 */
export function resolveCollisions({ scene, solve }) {
  const hitsBefore = solve.collision.hits.length;

  // --- 1. Trajectoire seule ------------------------------------------------
  const direct = localAutoCorrect({
    scene,
    actorPaths: solve.actorPaths,
    track: solve.track,
    colliders: solve.colliders,
    graph: solve.graph,
  });

  if (direct.resolved) {
    return {
      applied: true,
      resolved: true,
      scene: { ...scene, camera: { ...scene.camera, keys: waypointsToKeys(direct.waypoints, scene.project.duration) } },
      hitsBefore,
      hitsAfter: 0,
      note: direct.note,
      change: null,
    };
  }

  // --- 2. Variantes de rig -------------------------------------------------
  let fallback =
    direct.sweep.hits.length < hitsBefore
      ? {
          applied: true,
          resolved: false,
          scene: { ...scene, camera: { ...scene.camera, keys: waypointsToKeys(direct.waypoints, scene.project.duration) } },
          hitsBefore,
          hitsAfter: direct.sweep.hits.length,
          note: direct.note,
          change: null,
        }
      : null;

  for (const variant of RIG_VARIANTS) {
    const candidate = {
      ...scene,
      project: variant.duration
        ? { ...scene.project, duration: variant.duration(scene.project.duration) }
        : scene.project,
      camera: { ...scene.camera, keys: null, ...(variant.apply ? variant.apply(scene) : {}) },
    };

    const { scene: normalized } = normalizeSceneGraph(candidate);
    const nextSolve = solveScene(normalized);

    // La variante peut degager d'elle-meme, sinon on la relache a son tour.
    if (!nextSolve.collision.first) {
      return {
        applied: true,
        resolved: true,
        scene: normalized,
        hitsBefore,
        hitsAfter: 0,
        note: 'Degage en ajustant le rig, sans toucher a la trajectoire.',
        change: describe(variant, scene, normalized),
      };
    }

    const fix = localAutoCorrect({
      scene: normalized,
      actorPaths: nextSolve.actorPaths,
      track: nextSolve.track,
      colliders: nextSolve.colliders,
      graph: nextSolve.graph,
    });

    if (fix.resolved) {
      return {
        applied: true,
        resolved: true,
        scene: { ...normalized, camera: { ...normalized.camera, keys: waypointsToKeys(fix.waypoints, normalized.project.duration) } },
        hitsBefore,
        hitsAfter: 0,
        note: fix.note,
        change: describe(variant, scene, normalized),
      };
    }

    if (!fallback || fix.sweep.hits.length < fallback.hitsAfter) {
      fallback = {
        applied: true,
        resolved: false,
        scene: { ...normalized, camera: { ...normalized.camera, keys: waypointsToKeys(fix.waypoints, normalized.project.duration) } },
        hitsBefore,
        hitsAfter: fix.sweep.hits.length,
        note: fix.note,
        change: describe(variant, scene, normalized),
      };
    }
  }

  // --- 3. Rien de mieux que l'existant -------------------------------------
  if (!fallback || fallback.hitsAfter >= hitsBefore) {
    return {
      applied: false,
      resolved: false,
      scene: null,
      hitsBefore,
      hitsAfter: hitsBefore,
      note: "Aucune amelioration trouvee. Ni le relachement de trajectoire ni les variantes de rig ne degagent ce passage : le decor est trop etroit pour cette camera. Elargis l'ouverture, deplace l'obstacle, ou change de focale.",
      change: null,
    };
  }
  return fallback;
}
