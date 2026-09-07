import { Vector3 } from 'three';
import { zoneFootprint, orientedBounds, rotateOffset } from './geometry.js';
import { propBounds } from '../proxies/registry.js';

// Detection de collision camera, reelle et non scriptee.
//
// On construit les volumes du decor (murs perces aux ouvertures, montants de
// porte, props) puis on balaie la piste camera image par image. Le timecode et
// le nom d'obstacle affiches dans le panneau SYSTEM ALERT sortent de ce calcul.

export const CAMERA_RADIUS = 0.35; // encombrement du bloc camera + operateur
export const WALL_THICKNESS = 0.16;
const JAMB_WIDTH = 0.18; // largeur d'un montant de porte

const box = (id, name, kind, min, max) => ({ id, name, kind, min, max });

function aabbFromCenter(id, name, kind, center, size) {
  const h = [size[0] / 2, size[1] / 2, size[2] / 2];
  return box(
    id,
    name,
    kind,
    [center[0] - h[0], center[1] - h[1], center[2] - h[2]],
    [center[0] + h[0], center[1] + h[1], center[2] + h[2]]
  );
}

/**
 * Retranche les ouvertures d'un segment de mur.
 * @returns {[number, number][]} intervalles pleins restants
 */
function subtractOpenings(from, to, openings) {
  let spans = [[from, to]];
  for (const o of openings) {
    const next = [];
    for (const [a, b] of spans) {
      const oa = o.center - o.half;
      const ob = o.center + o.half;
      if (ob <= a || oa >= b) {
        next.push([a, b]);
        continue;
      }
      if (oa > a) next.push([a, oa]);
      if (ob < b) next.push([ob, b]);
    }
    spans = next;
  }
  return spans.filter(([a, b]) => b - a > 0.05);
}

/**
 * Construit tous les volumes bloquants de la scene.
 * @returns {object[]} liste d'AABB { id, name, kind, min, max }
 */
export function buildColliders(scene, graph) {
  const colliders = [];

  // En exterieur, les zones sont des aires (trottoir, carrefour), pas des
  // pieces : leur ceinturer des murs fabriquerait des obstacles qui n'existent
  // pas et noierait la detection sous de fausses collisions. Seuls les objets
  // bloquent alors la camera.
  const enclosed = scene.environment?.type !== 'exterior';

  for (const zone of enclosed ? scene.zones : []) {
    const f = zoneFootprint(zone);
    const y0 = zone.position[1];
    const h = zone.height;

    // Ouvertures portees par cette zone, classees par cote de mur.
    const doors = graph.doorways.filter((d) => d.from === zone.id || d.to === zone.id);

    const sides = [
      { key: 'minZ', axis: 'z', at: f.minZ, from: f.minX, to: f.maxX },
      { key: 'maxZ', axis: 'z', at: f.maxZ, from: f.minX, to: f.maxX },
      { key: 'minX', axis: 'x', at: f.minX, from: f.minZ, to: f.maxZ },
      { key: 'maxX', axis: 'x', at: f.maxX, from: f.minZ, to: f.maxZ },
    ];

    for (const side of sides) {
      // Une porte appartient a ce mur si son axe est perpendiculaire au mur et
      // qu'elle se situe sur sa ligne, a la tolerance de l'ecart inter-zones.
      const openings = doors
        .filter((d) => d.axis === side.axis)
        .filter((d) => {
          const coord = side.axis === 'z' ? d.position[2] : d.position[0];
          return Math.abs(coord - side.at) <= Math.max(1.6, Math.abs(d.gap) + 0.6);
        })
        .map((d) => ({
          center: side.axis === 'z' ? d.position[0] : d.position[2],
          half: d.width / 2,
          door: d,
        }));

      const spans = subtractOpenings(side.from, side.to, openings);
      spans.forEach(([a, b], i) => {
        const mid = (a + b) / 2;
        const len = b - a;
        const center =
          side.axis === 'z' ? [mid, y0 + h / 2, side.at] : [side.at, y0 + h / 2, mid];
        const size =
          side.axis === 'z' ? [len, h, WALL_THICKNESS] : [WALL_THICKNESS, h, len];
        colliders.push(
          aabbFromCenter(`${zone.id}_${side.key}_${i}`, `${zone.name} Wall`, 'wall', center, size)
        );
      });

      // Linteau au-dessus de chaque ouverture : la camera ne peut pas passer
      // par le haut de la porte.
      for (const o of openings) {
        const doorH = o.door.height;
        if (doorH >= h - 0.05) continue;
        const lintelH = h - doorH;
        const center =
          side.axis === 'z'
            ? [o.center, y0 + doorH + lintelH / 2, side.at]
            : [side.at, y0 + doorH + lintelH / 2, o.center];
        const size =
          side.axis === 'z'
            ? [o.half * 2, lintelH, WALL_THICKNESS]
            : [WALL_THICKNESS, lintelH, o.half * 2];
        colliders.push(
          aabbFromCenter(`${zone.id}_${side.key}_lintel_${o.door.id}`, o.door.name, 'doorframe', center, size)
        );
      }
    }
  }

  // Un prop de type "porte" pose dans une ouverture EST le cadre de cette
  // ouverture : on ne genere pas de montants par-dessus, sinon le passage se
  // retrouve retreci deux fois et devient infranchissable.
  const doorProps = (scene.props || [])
    .map((p) => ({ prop: p, bounds: propBounds(p) }))
    .filter((e) => e.bounds.type === 'door');
  const occupied = new Set();
  for (const door of graph.doorways) {
    const near = doorProps.find(
      (e) =>
        Math.hypot(e.prop.position[0] - door.position[0], e.prop.position[2] - door.position[2]) < 1.0
    );
    if (near) occupied.add(door.id);
  }

  // Montants de porte : deux volumes nommes d'apres l'ouverture. C'est ce qui
  // produit litteralement le libelle "Kitchen Doorframe" dans l'alerte.
  for (const door of enclosed ? graph.doorways : []) {
    if (occupied.has(door.id)) continue;
    const half = door.width / 2;
    const depth = Math.max(WALL_THICKNESS, Math.abs(door.gap) + WALL_THICKNESS);
    for (const sign of [-1, 1]) {
      const center =
        door.axis === 'z'
          ? [door.position[0] + sign * (half + JAMB_WIDTH / 2), door.height / 2, door.position[2]]
          : [door.position[0], door.height / 2, door.position[2] + sign * (half + JAMB_WIDTH / 2)];
      const size =
        door.axis === 'z'
          ? [JAMB_WIDTH, door.height, depth]
          : [depth, door.height, JAMB_WIDTH];
      colliders.push(
        aabbFromCenter(`${door.id}_jamb_${sign > 0 ? 'a' : 'b'}`, door.name, 'doorframe', center, size)
      );
    }
  }

  // Props.
  //
  // Chaque prop etait reduit a UN volume plein aligne sur les axes. Deux
  // consequences : une porte devenait un mur infranchissable alors que son proxy
  // dessine une ouverture, et la rotation etait purement ignoree, si bien qu'un
  // camion tourne a 90 degres presentait une empreinte croisee.
  for (const prop of scene.props || []) {
    const b = propBounds(prop);
    const rot = prop.rotation || 0;
    const base = [prop.position[0], 0, prop.position[2]];

    if (b.type === 'door') {
      // Deux montants et un linteau, exactement la geometrie que dessine le
      // proxy : ce que l'on voit reste ce qui bloque, et le passage reste libre.
      for (const part of doorFrameParts(b)) {
        const o = rotateOffset(part.offset, rot);
        colliders.push({
          id: `${prop.id}_${part.key}`,
          name: prop.name,
          kind: 'doorframe',
          ...orientedBounds([base[0] + o[0], part.offset[1], base[2] + o[2]], part.size, rot),
        });
      }
      continue;
    }

    colliders.push({
      id: prop.id,
      name: prop.name,
      kind: 'prop',
      ...orientedBounds([base[0], b.height / 2, base[2]], [b.width, b.height, b.depth], rot),
    });
  }

  return colliders;
}

/**
 * Decoupe d'un cadre de porte en volumes bloquants : deux montants lateraux et
 * un linteau. L'espace entre les montants reste libre, c'est le passage.
 */
function doorFrameParts(bounds) {
  const t = Math.min(JAMB_WIDTH, bounds.width * 0.16);
  const half = bounds.width / 2 - t / 2;
  return [
    { key: 'jamb_a', offset: [-half, bounds.height / 2, 0], size: [t, bounds.height, bounds.depth] },
    { key: 'jamb_b', offset: [half, bounds.height / 2, 0], size: [t, bounds.height, bounds.depth] },
    { key: 'lintel', offset: [0, bounds.height + t / 2, 0], size: [bounds.width + t, t, bounds.depth] },
  ];
}

/** Point du volume le plus proche de p. */
function closestPoint(aabb, p) {
  return new Vector3(
    Math.min(aabb.max[0], Math.max(aabb.min[0], p.x)),
    Math.min(aabb.max[1], Math.max(aabb.min[1], p.y)),
    Math.min(aabb.max[2], Math.max(aabb.min[2], p.z))
  );
}

/** Distance signee approchee d'un point a un volume (0 si a l'interieur). */
export function distanceToBox(aabb, p) {
  return closestPoint(aabb, p).distanceTo(p);
}

/** Distance au volume le plus proche. Utilise par l'auto-correction locale. */
export function clearanceAt(colliders, point) {
  let best = Infinity;
  let which = null;
  for (const c of colliders) {
    const d = distanceToBox(c, point);
    if (d < best) {
      best = d;
      which = c;
    }
  }
  return { distance: best, collider: which };
}

/** Vecteur de degagement le plus court hors d'un volume, dans le plan horizontal. */
export function escapeVector(aabb, p) {
  const cx = (aabb.min[0] + aabb.max[0]) / 2;
  const cz = (aabb.min[2] + aabb.max[2]) / 2;
  const halfX = (aabb.max[0] - aabb.min[0]) / 2;
  const halfZ = (aabb.max[2] - aabb.min[2]) / 2;
  const dx = p.x - cx;
  const dz = p.z - cz;
  const penX = halfX - Math.abs(dx);
  const penZ = halfZ - Math.abs(dz);
  // On sort par la face la moins enfoncee : deplacement minimal.
  if (penX < penZ) return new Vector3(Math.sign(dx) || 1, 0, 0);
  return new Vector3(0, 0, Math.sign(dz) || 1);
}

export function formatTimecode(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function formatTimecodeFrames(seconds, fps) {
  const total = Math.max(0, Math.round(seconds * fps));
  const f = total % fps;
  return `${formatTimecode(Math.floor(total / fps))}:${String(f).padStart(2, '0')}`;
}

/**
 * Balaie la piste camera contre le decor.
 *
 * `first` est la premiere image en contact ; `worst` est le contact le plus
 * profond. C'est `worst` que l'alerte met en avant : sur une trajectoire qui
 * frole plusieurs volumes, l'obstacle reellement bloquant est celui ou la
 * penetration est maximale, pas celui qu'on effleure en premier.
 *
 * @returns {{ hits, first, worst, collidingFrames, colliders, obstacles }}
 */
export function sweepCamera(track, colliders, radius = CAMERA_RADIUS) {
  const hits = [];
  const collidingFrames = new Set();
  const dt = track.frames.length > 1 ? track.duration / (track.frames.length - 1) : 0;

  track.frames.forEach((frame, index) => {
    let worst = null;
    for (const c of colliders) {
      const d = distanceToBox(c, frame.position);
      if (d >= radius) continue;
      const penetration = radius - d;
      if (!worst || penetration > worst.penetration) {
        worst = { collider: c, penetration };
      }
    }
    if (!worst) return;

    collidingFrames.add(index);
    const time = index * dt;
    hits.push({
      frame: index,
      time,
      timecode: formatTimecode(time),
      obstacleId: worst.collider.id,
      obstacleName: worst.collider.name,
      obstacleKind: worst.collider.kind,
      collider: worst.collider,
      penetration: worst.penetration,
      position: frame.position.clone(),
    });
  });

  // Recapitulatif par obstacle : le panneau d'alerte liste ce qui bloque
  // vraiment, pas seulement le premier contact.
  const byObstacle = new Map();
  for (const h of hits) {
    const entry = byObstacle.get(h.obstacleName) || {
      name: h.obstacleName,
      kind: h.obstacleKind,
      frames: 0,
      firstTime: h.time,
      lastTime: h.time,
      penetration: 0,
    };
    entry.frames += 1;
    entry.lastTime = h.time;
    entry.penetration = Math.max(entry.penetration, h.penetration);
    byObstacle.set(h.obstacleName, entry);
  }

  const worst = hits.reduce((acc, h) => (!acc || h.penetration > acc.penetration ? h : acc), null);

  return {
    hits,
    first: hits[0] || null,
    worst,
    collidingFrames,
    colliders,
    obstacles: [...byObstacle.values()].sort((a, b) => b.penetration - a.penetration),
  };
}
