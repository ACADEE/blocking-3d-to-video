import { CatmullRomCurve3, Vector3 } from 'three';
import { makePath } from './paths.js';

// Rigs camera.
//
// Choix de modelisation important : un rig de suivi n'est PAS un point fige sur
// la courbe de l'acteur. Un operateur steadicam vise un point derriere son sujet
// mais trace sa propre ligne, plus lisse, qui coupe les virages. Cette coupe de
// virage est precisement ce qui fait heurter les encadrements de porte en previz.
// On modelise donc la camera comme un suivi amorti (passe-bas) de la consigne.
//
// L'integration est faite une seule fois, de maniere deterministe, et le
// resultat est stocke image par image. Lire la camera a l'instant t reste donc
// une simple lecture de tableau : le scrub de la timeline demeure exact.

const SENSOR_HEIGHT_MM = 24; // 35 mm plein format (36 x 24)

/** Focale (mm) vers champ vertical (degres), convention three.js. */
export function lensToFov(lensMm) {
  const mm = Math.max(1, Number(lensMm) || 35);
  return (2 * Math.atan(SENSOR_HEIGHT_MM / (2 * mm)) * 180) / Math.PI;
}

export function fovToLens(fovDeg) {
  const rad = (Math.max(1, fovDeg) * Math.PI) / 180;
  return SENSOR_HEIGHT_MM / (2 * Math.tan(rad / 2));
}

// Constantes de temps du lissage, par rig. Plus tau est grand, plus la camera
// est douce et plus elle coupe les virages.
const RIG_TUNING = {
  steadicam: { tau: 0.38, lookTau: 0.22, sway: 0.05, bob: 0.025, freq: 0.9 },
  handheld: { tau: 0.16, lookTau: 0.1, sway: 0.16, bob: 0.11, freq: 2.7 },
  static: { tau: 0, lookTau: 0.25, sway: 0, bob: 0, freq: 0 },
  dolly: { tau: 0, lookTau: 0.2, sway: 0, bob: 0, freq: 0 },
  crane: { tau: 0, lookTau: 0.3, sway: 0, bob: 0, freq: 0 },
};

/**
 * Oscillation deterministe : somme de sinusoides a phases fixes. Pas de PRNG,
 * donc rejouer la scene donne exactement la meme trajectoire, ce qui est
 * indispensable pour que la detection de collision soit reproductible.
 */
function wobble(t, freq, phase) {
  return Math.sin(t * freq * 2.0 + phase) * 0.62 + Math.sin(t * freq * 5.3 + phase * 1.7) * 0.38;
}

/**
 * Piste construite sur des cles d'animation.
 *
 * La contrainte qui commande tout : a l'instant d'une cle, la camera doit etre
 * exactement ou l'utilisateur l'a posee. On interpole donc en `getPoint`, qui
 * passe par les points de controle, et non en `getPointAt`, qui reparametre par
 * longueur d'arc et raterait les cles.
 *
 * @param {{t:number, position:number[], target?:number[]}[]} keys
 */
export function makeKeyTrack(keys) {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const times = sorted.map((k) => k.t);
  const n = sorted.length;
  const points = sorted.map((k) => new Vector3(k.position[0], k.position[1], k.position[2]));
  const curve = n >= 2 ? new CatmullRomCurve3(points, false, 'centripetal', 0.5) : null;

  // Temps -> parametre de courbe, par morceaux : la cle i tombe sur i/(n-1).
  const uAt = (time) => {
    if (n < 2 || time <= times[0]) return 0;
    if (time >= times[n - 1]) return 1;
    let i = 0;
    while (i < n - 2 && times[i + 1] < time) i += 1;
    const span = times[i + 1] - times[i] || 1;
    return (i + (time - times[i]) / span) / (n - 1);
  };

  const hasTargets = sorted.every((k) => Array.isArray(k.target) && k.target.length >= 3);

  return {
    keys: sorted,
    positionAt: (time) => (curve ? curve.getPoint(uAt(time)) : points[0].clone()),
    /** Point vise, seulement si toutes les cles en portent un. */
    targetAt: hasTargets
      ? (time) => {
          if (time <= times[0]) return new Vector3(...sorted[0].target);
          if (time >= times[n - 1]) return new Vector3(...sorted[n - 1].target);
          let i = 0;
          while (i < n - 2 && times[i + 1] < time) i += 1;
          const span = times[i + 1] - times[i] || 1;
          const k = (time - times[i]) / span;
          return new Vector3(...sorted[i].target).lerp(new Vector3(...sorted[i + 1].target), k);
        }
      : null,
  };
}

/**
 * Convertit une polyligne spatiale en cles reparties dans le temps.
 * Utilise pour que l'auto-correction produise, elle aussi, des cles editables a
 * la main : il n'existe qu'un seul mecanisme de trajectoire imposee.
 */
export function waypointsToKeys(waypoints, duration, count = 24) {
  const path = makePath(waypoints);
  const n = Math.max(2, Math.min(count, 64));
  const keys = [];
  for (let i = 0; i < n; i += 1) {
    const u = i / (n - 1);
    const p = path.pointAt(u * path.length);
    keys.push({
      t: Number((u * duration).toFixed(4)),
      position: [Number(p.x.toFixed(4)), Number(p.y.toFixed(4)), Number(p.z.toFixed(4))],
    });
  }
  return keys;
}

/**
 * Calcule la piste camera image par image.
 *
 * @param {object} scene SceneGraph normalise
 * @param {Map<string, object>} actorPaths id acteur -> resultat de buildActorPath
 * @returns {{ frames: {position: Vector3, lookAt: Vector3}[], fov: number, fps: number,
 *             duration: number, positions: Vector3[], source: string }}
 */
export function solveCameraTrack(scene, actorPaths) {
  const { camera, project } = scene;
  const fps = project.fps;
  const duration = project.duration;
  const frameCount = Math.max(2, Math.round(duration * fps) + 1);
  const dt = duration / (frameCount - 1);
  const tuning = RIG_TUNING[camera.rig] || RIG_TUNING.steadicam;

  const target = camera.target ? actorPaths.get(camera.target) : null;
  const targetPath = target ? target.path : null;

  // Position du sujet a l'instant normalise u, a hauteur de regard.
  const subjectAt = (u) => {
    if (!targetPath) return new Vector3(0, 1.5, 0);
    const p = targetPath.pointAt(u * targetPath.length);
    const actor = scene.actors.find((a) => a.id === camera.target);
    p.y = (actor ? actor.height : 1.7) * 0.88;
    return p;
  };

  // --- Consigne de position, par rig -------------------------------------
  let goalAt;
  let source = camera.rig;

  // Cles d'animation : elles font autorite. Ni amortissement ni oscillation,
  // sinon la camera ne serait pas ou l'utilisateur l'a posee — ce qui vidait la
  // pose de cle de son sens.
  const keyTrack = camera.keys && camera.keys.length >= 2 ? makeKeyTrack(camera.keys) : null;

  if (keyTrack) {
    source = 'keyframed';
    goalAt = (u) => keyTrack.positionAt(u * duration);
  } else if (camera.rig === 'static') {
    const anchor = subjectAt(0);
    const dir = targetPath ? targetPath.tangentAt(0) : new Vector3(0, 0, -1);
    const fixed = anchor.clone().addScaledVector(dir, -camera.distance * 1.4);
    fixed.y = camera.height;
    goalAt = () => fixed.clone();
  } else if (camera.rig === 'dolly') {
    const a = subjectAt(0);
    const b = subjectAt(1);
    const dir = b.clone().sub(a).setY(0);
    const len = dir.length() || 1;
    dir.normalize();
    const perp = new Vector3(-dir.z, 0, dir.x);
    // Travelling lateral : la camera longe l'action a distance constante.
    const from = a.clone().addScaledVector(perp, camera.distance).setY(camera.height);
    const to = a
      .clone()
      .addScaledVector(dir, len)
      .addScaledVector(perp, camera.distance)
      .setY(camera.height);
    goalAt = (u) => from.clone().lerp(to, u);
  } else if (camera.rig === 'crane') {
    const a = subjectAt(0);
    const b = subjectAt(1);
    const dir = b.clone().sub(a).setY(0).normalize();
    const from = a.clone().addScaledVector(dir, -camera.distance * 2).setY(camera.height + 4.5);
    const to = b.clone().addScaledVector(dir, -camera.distance).setY(camera.height);
    goalAt = (u) => {
      const p = from.clone().lerp(to, u);
      p.y += Math.sin(u * Math.PI) * 1.2; // descente en arc, pas en ligne droite
      return p;
    };
  } else {
    // steadicam / handheld : point vise a `distance` derriere le sujet, le long
    // de sa propre trajectoire.
    goalAt = (u) => {
      if (!targetPath) return new Vector3(0, camera.height, camera.distance);
      const p = targetPath.pointAt(u * targetPath.length - camera.distance);
      p.y = camera.height;
      return p;
    };
  }

  // --- Integration deterministe -------------------------------------------
  const frames = [];
  const positions = [];
  let pos = goalAt(0).clone();
  let look = subjectAt(0).clone();

  // Coefficients de lissage exponentiel. tau = 0 => suivi rigide (rigs sur rail).
  const alphaPos = keyTrack || tuning.tau <= 0 ? 1 : 1 - Math.exp(-dt / tuning.tau);
  const alphaLook = tuning.lookTau > 0 ? 1 - Math.exp(-dt / tuning.lookTau) : 1;

  for (let i = 0; i < frameCount; i += 1) {
    const t = i * dt;
    const u = frameCount > 1 ? i / (frameCount - 1) : 0;

    const goal = goalAt(u);
    pos = pos.lerp(goal, alphaPos);

    // Une cle peut porter son propre point vise : l'orientation est alors
    // imposee, sinon la camera continue de cadrer le sujet.
    const desiredLook = (keyTrack && keyTrack.targetAt && keyTrack.targetAt(t)) || subjectAt(u);
    look = keyTrack && keyTrack.targetAt ? desiredLook : look.lerp(desiredLook, alphaLook);

    // Oscillation du rig, appliquee dans le repere de la camera pour que le
    // devers soit lateral et non aligne sur les axes du monde.
    const out = pos.clone();
    if (!keyTrack && (tuning.sway > 0 || tuning.bob > 0)) {
      const forward = desiredLook.clone().sub(pos).setY(0);
      if (forward.lengthSq() > 1e-6) {
        forward.normalize();
        const right = new Vector3(-forward.z, 0, forward.x);
        out.addScaledVector(right, wobble(t, tuning.freq, 0.0) * tuning.sway);
        out.y += wobble(t, tuning.freq * 1.31, 2.1) * tuning.bob;
      }
    }

    frames.push({ position: out, lookAt: look.clone() });
    positions.push(out);
  }

  return { frames, positions, fov: lensToFov(camera.lens), fps, duration, source };
}

/** Lecture de la piste a un instant donne. Interpolation entre images voisines. */
export function cameraAtTime(track, time) {
  const { frames, duration } = track;
  if (!frames.length) return { position: new Vector3(), lookAt: new Vector3(0, 0, -1) };
  const u = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;
  const f = u * (frames.length - 1);
  const i = Math.min(frames.length - 2, Math.floor(f));
  const k = f - i;
  const a = frames[i];
  const b = frames[Math.min(frames.length - 1, i + 1)];
  return {
    position: a.position.clone().lerp(b.position, k),
    lookAt: a.lookAt.clone().lerp(b.lookAt, k),
  };
}
