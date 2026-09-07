import { CatmullRomCurve3, Vector3 } from 'three';
import { zoneFootprint } from './geometry.js';
import { findRoute } from './graph.js';

// Trajectoires continues.
//
// Regle du projet : la scene est une fonction pure du temps. Un deplacement est
// une courbe pre-echantillonnee a pas d'abscisse curviligne constant ; lire la
// position revient a interpoler dedans. Il n'existe aucun etat accumule d'une
// image a l'autre, donc aucune occasion de sauter ou de se teleporter, et le
// scrub de la timeline est exact par construction.

const SAMPLES = 600;
const APPROACH = 0.9; // recul de part et d'autre d'une porte, pour la franchir droit

/** Vitesses de marche plausibles (m/s), utilisees seulement pour signaler, jamais pour corriger. */
export const HUMAN_SPEED = { min: 0.7, max: 2.2 };

function dedupe(points, epsilon = 1e-3) {
  const out = [];
  for (const p of points) {
    const v = p instanceof Vector3 ? p.clone() : new Vector3(p[0], p[1] ?? 0, p[2]);
    if (!out.length || out[out.length - 1].distanceTo(v) > epsilon) out.push(v);
  }
  return out;
}

/**
 * Construit une trajectoire echantillonnee a pas constant.
 * @param {Array<[number,number,number]|Vector3>} waypoints
 */
export function makePath(waypoints) {
  const pts = dedupe(waypoints);

  if (pts.length === 0) {
    const zero = new Vector3();
    return degeneratePath(zero);
  }
  if (pts.length === 1) {
    return degeneratePath(pts[0]);
  }

  // 'centripetal' evite les boucles et depassements que la variante uniforme
  // produit sur des waypoints inegalement espaces (typique d'un couloir).
  const curve = new CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const samples = curve.getSpacedPoints(SAMPLES); // SAMPLES + 1 points equidistants

  let length = 0;
  for (let i = 1; i < samples.length; i += 1) length += samples[i].distanceTo(samples[i - 1]);
  if (length < 1e-6) return degeneratePath(pts[0]);

  const step = length / (samples.length - 1);
  return buildPath(samples, length, step, pts);
}

function degeneratePath(point) {
  const p = point.clone();
  return {
    samples: [p],
    waypoints: [p.clone()],
    length: 0,
    step: 0,
    degenerate: true,
    pointAt: () => p.clone(),
    tangentAt: () => new Vector3(0, 0, -1),
    at: () => ({ position: p.clone(), tangent: new Vector3(0, 0, -1) }),
  };
}

function buildPath(samples, length, step, waypoints) {
  const last = samples.length - 1;

  // Tangentes aux extremites, memorisees pour l'extrapolation hors trajectoire
  // (la camera se place en arriere du sujet et peut demander s < 0).
  const headTangent = samples[1].clone().sub(samples[0]).normalize();
  const tailTangent = samples[last].clone().sub(samples[last - 1]).normalize();

  const pointAt = (s) => {
    if (s <= 0) return samples[0].clone().addScaledVector(headTangent, s);
    if (s >= length) return samples[last].clone().addScaledVector(tailTangent, s - length);
    const f = s / step;
    const i = Math.min(last - 1, Math.floor(f));
    return samples[i].clone().lerp(samples[i + 1], f - i);
  };

  const tangentAt = (s) => {
    if (s <= 0) return headTangent.clone();
    if (s >= length) return tailTangent.clone();
    const i = Math.min(last - 1, Math.max(0, Math.floor(s / step)));
    return samples[i + 1].clone().sub(samples[i]).normalize();
  };

  return {
    samples,
    waypoints,
    length,
    step,
    degenerate: false,
    pointAt,
    tangentAt,
    at: (s) => ({ position: pointAt(s), tangent: tangentAt(s) }),
  };
}

/** Position et orientation a un instant normalise [0,1]. Vitesse constante. */
export function samplePathAtT(path, t01) {
  const t = Math.min(1, Math.max(0, t01));
  return path.at(t * path.length);
}

const zoneCenter = (zone) => new Vector3(zone.position[0], 0, zone.position[2]);

/**
 * Decalage lateral par acteur : deux personnages qui partagent un trajet ne
 * doivent pas s'interpenetrer. On decale perpendiculairement a la marche.
 */
function lane(index) {
  if (index === 0) return 0;
  const rank = Math.ceil(index / 2);
  return (index % 2 === 1 ? 1 : -1) * rank * 0.75;
}

function offsetPoint(point, direction, amount) {
  if (!amount) return point;
  const perp = new Vector3(-direction.z, 0, direction.x).normalize();
  return point.clone().addScaledVector(perp, amount);
}

/**
 * Trajet d'un acteur qui reste dans sa zone : il traverse la piece plutot que
 * de rester plante. Le cas "Waiter, startZone === endZone" du SceneGraph de
 * reference tombe ici.
 */
function buildCrossingWaypoints(zone, doorways, offset) {
  const f = zoneFootprint(zone);
  const center = zoneCenter(zone);
  const inset = 0.9;

  // On traverse perpendiculairement a l'axe des portes de la piece, pour couper
  // le flux principal plutot que de le doubler.
  const doorAxes = doorways.filter((d) => d.from === zone.id || d.to === zone.id).map((d) => d.axis);
  const crossOnX = doorAxes.length === 0 || doorAxes.includes('z');

  if (crossOnX) {
    const z = center.z + offset;
    return [
      new Vector3(f.minX + inset, 0, z),
      new Vector3(center.x, 0, z + 0.4),
      new Vector3(f.maxX - inset, 0, z),
    ];
  }
  const x = center.x + offset;
  return [
    new Vector3(x, 0, f.minZ + inset),
    new Vector3(x + 0.4, 0, center.z),
    new Vector3(x, 0, f.maxZ - inset),
  ];
}

/**
 * Construit la trajectoire d'un acteur a travers le graphe de zones.
 * @returns {{ path: object, route: object|null, speed: number, warning: string|null, doorTimes: object[] }}
 */
export function buildActorPath(actor, zones, graph, duration, index = 0) {
  const byId = new Map(zones.map((z) => [z.id, z]));
  const startZone = byId.get(actor.startZone) || zones[0];
  const endZone = byId.get(actor.endZone) || startZone;
  const offset = lane(index);
  let warning = null;

  let waypoints;
  let route = null;

  // Trajectoire posee a la main : elle fait autorite. Le reste du pipeline est
  // inchange — lissage centripete puis re-echantillonnage par longueur d'arc —
  // donc la garantie d'absence de teleportation tient toujours : elle vient de
  // l'echantillonnage, pas de l'origine des points.
  if (actor.waypoints && actor.waypoints.length >= 2) {
    const path = makePath(actor.waypoints.map((w) => new Vector3(w[0], 0, w[2])));
    const speed = duration > 0 ? path.length / duration : 0;
    return {
      path,
      route: { zones: [startZone.id, endZone.id], doorways: [], authored: true },
      speed,
      warning:
        speed > HUMAN_SPEED.max
          ? `"${actor.name}" parcourt ${path.length.toFixed(1)} m en ${duration}s, soit ${speed.toFixed(2)} m/s.`
          : null,
      doorTimes: [],
      authored: true,
    };
  }

  if (startZone.id === endZone.id) {
    waypoints = buildCrossingWaypoints(startZone, graph.doorways, offset);
    route = { zones: [startZone.id], doorways: [] };
  } else {
    route = findRoute(graph.adjacency, startZone.id, endZone.id);

    if (!route) {
      // Zones non reliees : plutot que d'immobiliser l'acteur ou de le faire
      // sauter, on trace un couloir implicite entre les deux centres.
      warning = `"${actor.name}" : aucune liaison entre "${startZone.name}" et "${endZone.name}". Trajet direct force.`;
      const a = zoneCenter(startZone);
      const b = zoneCenter(endZone);
      const dir = b.clone().sub(a).normalize();
      waypoints = [offsetPoint(a, dir, offset), offsetPoint(b, dir, offset)];
      route = { zones: [startZone.id, endZone.id], doorways: [] };
    } else {
      const pts = [];
      const first = byId.get(route.zones[0]);
      const firstDoor = route.doorways[0];
      const initialDir = firstDoor
        ? new Vector3(firstDoor.position[0], 0, firstDoor.position[2]).sub(zoneCenter(first)).normalize()
        : new Vector3(0, 0, -1);
      pts.push(offsetPoint(zoneCenter(first), initialDir, offset));

      route.doorways.forEach((door, i) => {
        const doorPos = new Vector3(door.position[0], 0, door.position[2]);
        const prevZone = byId.get(route.zones[i]);
        const nextZone = byId.get(route.zones[i + 1]);
        const axis = door.axis === 'z' ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
        const sign = Math.sign(
          (door.axis === 'z' ? nextZone.position[2] - prevZone.position[2] : nextZone.position[0] - prevZone.position[0]) || 1
        );
        const normal = axis.clone().multiplyScalar(sign);

        // Points d'approche de part et d'autre : la courbe traverse l'ouverture
        // perpendiculairement au lieu de couper l'angle dans le mur.
        pts.push(doorPos.clone().addScaledVector(normal, -APPROACH));
        pts.push(doorPos.clone());
        pts.push(doorPos.clone().addScaledVector(normal, APPROACH));

        if (i === route.doorways.length - 1) {
          pts.push(offsetPoint(zoneCenter(nextZone), normal, offset));
        }
      });

      waypoints = pts;
    }
  }

  const path = makePath(waypoints);
  const speed = duration > 0 ? path.length / duration : 0;

  if (!warning && speed > HUMAN_SPEED.max) {
    warning = `"${actor.name}" doit parcourir ${path.length.toFixed(1)} m en ${duration}s, soit ${speed.toFixed(
      2
    )} m/s. Allonge la duree pour une marche credible.`;
  }

  // Instants de franchissement, pour les marqueurs de la timeline.
  const doorTimes = [];
  if (route && route.doorways.length && path.length > 0) {
    for (const door of route.doorways) {
      const target = new Vector3(door.position[0], 0, door.position[2]);
      let bestIndex = 0;
      let bestDist = Infinity;
      path.samples.forEach((p, i) => {
        const d = p.distanceTo(target);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      });
      doorTimes.push({
        doorway: door,
        t: bestIndex / (path.samples.length - 1),
        time: (bestIndex / (path.samples.length - 1)) * duration,
      });
    }
  }

  return { path, route, speed, warning, doorTimes };
}
