import { zoneFootprint } from './geometry.js';

// Graphe de navigation entre zones.
//
// Deux zones sont reliees quand leurs empreintes se font face sur un axe a
// faible distance et se recouvrent suffisamment sur l'autre pour qu'une porte
// tienne. Chaque liaison produit une "doorway" qui sert simultanement de :
//   - passage oblige pour les acteurs (aucune traversee de mur),
//   - ouverture percee dans le mur au rendu,
//   - collider nomme "<Zone> Doorframe" pour la detection de collision camera.

export const DOOR_WIDTH = 1.4;
export const DOOR_HEIGHT = 2.1;
const MAX_GAP = 2.5; // ecart maximal tolere entre deux zones pour les relier
const MIN_OVERLAP = 1.0; // recouvrement lateral minimal pour loger une porte

/**
 * Teste l'adjacence de deux zones et, le cas echeant, decrit l'ouverture.
 * @returns {null | { axis: 'x'|'z', position: [number,number,number], width: number, gap: number }}
 */
export function connection(a, b) {
  const fa = zoneFootprint(a);
  const fb = zoneFootprint(b);

  const test = (axis) => {
    const [minA, maxA, minB, maxB] =
      axis === 'z' ? [fa.minZ, fa.maxZ, fb.minZ, fb.maxZ] : [fa.minX, fa.maxX, fb.minX, fb.maxX];
    const [oMinA, oMaxA, oMinB, oMaxB] =
      axis === 'z' ? [fa.minX, fa.maxX, fb.minX, fb.maxX] : [fa.minZ, fa.maxZ, fb.minZ, fb.maxZ];

    // Recouvrement sur l'axe perpendiculaire : il faut de la place pour la porte.
    const overlap = Math.min(oMaxA, oMaxB) - Math.max(oMinA, oMinB);
    if (overlap < MIN_OVERLAP) return null;

    // Les deux configurations face a face possibles sur l'axe teste.
    const candidates = [
      { gap: minB - maxA, mid: (maxA + minB) / 2 }, // b apres a
      { gap: minA - maxB, mid: (maxB + minA) / 2 }, // a apres b
    ];
    const hit = candidates
      .filter((c) => c.gap >= -0.05 && c.gap <= MAX_GAP)
      .sort((c, d) => Math.abs(c.gap) - Math.abs(d.gap))[0];
    if (!hit) return null;

    const perpCenter = (Math.max(oMinA, oMinB) + Math.min(oMaxA, oMaxB)) / 2;
    const width = Math.min(DOOR_WIDTH, overlap);
    return {
      axis,
      overlap,
      width,
      gap: hit.gap,
      position: axis === 'z' ? [perpCenter, 0, hit.mid] : [hit.mid, 0, perpCenter],
    };
  };

  // On garde l'axe dont l'ecart est le plus faible : c'est le contact reel.
  const results = [test('z'), test('x')].filter(Boolean);
  if (results.length === 0) return null;
  return results.sort((a2, b2) => Math.abs(a2.gap) - Math.abs(b2.gap))[0];
}

/**
 * Construit le graphe complet.
 * @returns {{ doorways: object[], adjacency: Map<string, {zone: string, doorway: object}[]> }}
 */
export function buildZoneGraph(zones) {
  const doorways = [];
  const adjacency = new Map(zones.map((z) => [z.id, []]));

  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      const c = connection(zones[i], zones[j]);
      if (!c) continue;

      // Le nom vient de la seconde zone dans l'ordre de la scene : en pratique
      // celle vers laquelle on progresse, d'ou des libelles du type
      // "Kitchen Doorframe" attendus dans l'alerte systeme.
      const doorway = {
        id: `door_${zones[i].id}_${zones[j].id}`,
        name: `${zones[j].name} Doorframe`,
        from: zones[i].id,
        to: zones[j].id,
        axis: c.axis,
        width: c.width,
        height: Math.min(DOOR_HEIGHT, Math.min(zones[i].height, zones[j].height) - 0.1),
        position: c.position,
        gap: c.gap,
      };
      doorways.push(doorway);
      adjacency.get(zones[i].id).push({ zone: zones[j].id, doorway });
      adjacency.get(zones[j].id).push({ zone: zones[i].id, doorway });
    }
  }

  return { doorways, adjacency };
}

/**
 * Plus court chemin en nombre de pieces (BFS).
 * @returns {null | { zones: string[], doorways: object[] }}
 */
export function findRoute(adjacency, startId, endId) {
  if (startId === endId) return { zones: [startId], doorways: [] };
  if (!adjacency.has(startId) || !adjacency.has(endId)) return null;

  const prev = new Map([[startId, null]]);
  const queue = [startId];

  while (queue.length) {
    const current = queue.shift();
    if (current === endId) break;
    for (const edge of adjacency.get(current) || []) {
      if (prev.has(edge.zone)) continue;
      prev.set(edge.zone, { zone: current, doorway: edge.doorway });
      queue.push(edge.zone);
    }
  }

  if (!prev.has(endId)) return null;

  const zoneIds = [];
  const doors = [];
  let cursor = endId;
  while (cursor != null) {
    zoneIds.unshift(cursor);
    const step = prev.get(cursor);
    if (!step) break;
    doors.unshift(step.doorway);
    cursor = step.zone;
  }
  return { zones: zoneIds, doorways: doors };
}
