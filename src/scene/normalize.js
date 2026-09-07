// Garde-fou entre la sortie du LLM et le rendu. Un SceneGraph normalise est
// toujours coherent : ids uniques, references resolues, zones non superposees.
// Le viewport ne doit jamais avoir a se defendre contre une sortie modele.

import { zoneFootprint } from './geometry.js';
import { buildZoneGraph } from './graph.js';
import { waypointsToKeys } from './camera.js';

// Re-export : plusieurs modules importaient ces helpers depuis ici.
export { zoneFootprint, zoneBox } from './geometry.js';

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

const HEX = /^#[0-9a-f]{6}$/i;
const color = (c, fallback) => (typeof c === 'string' && HEX.test(c.trim()) ? c.trim() : fallback);

const ZONE_PALETTE = ['#2A2A2A', '#3A2F28', '#4A4A4A', '#2A3338', '#3A3428', '#2F2A38'];
const ACTOR_PALETTE = ['#F27D26', '#2F6B8A', '#8A2F3A', '#3F8A5C', '#8A742F', '#6B2F8A'];

function vec3(v, fallback = [0, 0, 0]) {
  if (!Array.isArray(v) || v.length < 3) return [...fallback];
  return v.slice(0, 3).map((n) => (Number.isFinite(Number(n)) ? Number(n) : 0));
}

/**
 * Ecarte les zones dont les empreintes se chevauchent, le long de l'axe de plus
 * faible penetration. Le prompt demande deja au modele d'espacer les zones, mais
 * on ne peut pas s'y fier : une superposition rendrait le graphe de portes absurde.
 */
function deoverlapZones(zones, gap = 1) {
  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;
    for (let i = 0; i < zones.length; i += 1) {
      for (let j = i + 1; j < zones.length; j += 1) {
        const a = zoneFootprint(zones[i]);
        const b = zoneFootprint(zones[j]);
        const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
        if (overlapX <= 0 || overlapZ <= 0) continue;

        moved = true;
        // On repousse selon l'axe ou la penetration est la plus faible : c'est
        // le deplacement minimal qui separe les deux volumes.
        if (overlapZ <= overlapX) {
          const push = (overlapZ + gap) / 2;
          const dir = zones[j].position[2] >= zones[i].position[2] ? 1 : -1;
          zones[i].position[2] -= push * dir;
          zones[j].position[2] += push * dir;
        } else {
          const push = (overlapX + gap) / 2;
          const dir = zones[j].position[0] >= zones[i].position[0] ? 1 : -1;
          zones[i].position[0] -= push * dir;
          zones[j].position[0] += push * dir;
        }
      }
    }
    if (!moved) break;
  }
  return zones;
}


/**
 * Cles d'animation camera : instants croissants et bornes a la prise, positions
 * exploitables. Une seule cle ne definit pas une trajectoire, on l'ignore.
 */
function normalizeKeys(raw, duration) {
  if (!Array.isArray(raw)) return null;
  const keys = raw
    .filter((k) => k && Array.isArray(k.position))
    .map((k) => ({
      t: clamp(k.t, 0, duration, 0),
      position: vec3(k.position),
      ...(Array.isArray(k.target) && k.target.length >= 3 ? { target: vec3(k.target) } : {}),
    }))
    .sort((a, b) => a.t - b.t);
  return keys.length >= 2 ? keys : null;
}

export const CAMERA_RIGS = ['steadicam', 'handheld', 'static', 'dolly', 'crane'];

// Rayon de recherche pour aimanter une porte sur une ouverture existante.
const DOOR_SNAP_RADIUS = 4;

/**
 * @param {object} input SceneGraph brut (modele, fichier importe, fixture)
 * @returns {{ scene: object, warnings: string[] }}
 */
export function normalizeSceneGraph(input) {
  const warnings = [];
  const raw = input && typeof input === 'object' ? input : {};

  const project = {
    name:
      typeof raw.project?.name === 'string' && raw.project.name.trim()
        ? raw.project.name.trim()
        : 'Untitled Scene',
    duration: clamp(raw.project?.duration, 1, 600, 15),
    fps: clamp(Math.round(raw.project?.fps ?? 24), 1, 120, 24),
    aspectRatio: typeof raw.project?.aspectRatio === 'string' ? raw.project.aspectRatio : '16:9',
  };

  const environment = { type: raw.environment?.type === 'exterior' ? 'exterior' : 'interior' };

  // --- Zones -------------------------------------------------------------
  const seenZoneIds = new Set();
  let zones = (Array.isArray(raw.zones) ? raw.zones : []).map((z, i) => {
    let id = typeof z?.id === 'string' && z.id.trim() ? z.id.trim() : `zone_${i + 1}`;
    while (seenZoneIds.has(id)) id = `${id}_${i + 1}`;
    seenZoneIds.add(id);
    return {
      id,
      name: typeof z?.name === 'string' && z.name.trim() ? z.name.trim() : `Zone ${i + 1}`,
      width: clamp(z?.width, 1.5, 200, 8),
      depth: clamp(z?.depth, 1.5, 200, 8),
      height: clamp(z?.height, 2, 40, 3),
      color: color(z?.color, ZONE_PALETTE[i % ZONE_PALETTE.length]),
      position: vec3(z?.position, [0, 0, -i * 10]),
    };
  });

  if (zones.length === 0) {
    warnings.push('Aucune zone exploitable dans la reponse : une zone par defaut a ete creee.');
    zones = [
      {
        id: 'zone_1',
        name: 'Main Area',
        width: 10,
        depth: 10,
        height: 3,
        color: ZONE_PALETTE[0],
        position: [0, 0, 0],
      },
    ];
  }

  const before = zones.map((z) => z.position.join(','));
  zones = deoverlapZones(zones);
  if (zones.some((z, i) => z.position.join(',') !== before[i])) {
    warnings.push('Des zones se chevauchaient : elles ont ete ecartees automatiquement.');
  }

  const zoneIds = new Set(zones.map((z) => z.id));
  const resolveZone = (id, fallback, label) => {
    if (typeof id === 'string' && zoneIds.has(id)) return id;
    warnings.push(`${label} pointait vers une zone inexistante ("${id}") : rattache a "${fallback}".`);
    return fallback;
  };

  // --- Acteurs -----------------------------------------------------------
  const seenActorIds = new Set();
  const actors = (Array.isArray(raw.actors) ? raw.actors : []).map((a, i) => {
    let id = typeof a?.id === 'string' && a.id.trim() ? a.id.trim() : `actor_${i + 1}`;
    while (seenActorIds.has(id)) id = `${id}_${i + 1}`;
    seenActorIds.add(id);
    const name = typeof a?.name === 'string' && a.name.trim() ? a.name.trim() : `Actor ${i + 1}`;
    return {
      id,
      name,
      height: clamp(a?.height, 0.4, 3, 1.7),
      startZone: resolveZone(a?.startZone, zones[0].id, `L'acteur "${name}" (startZone)`),
      endZone: resolveZone(a?.endZone, zones[zones.length - 1].id, `L'acteur "${name}" (endZone)`),
      action: typeof a?.action === 'string' ? a.action : '',
      color: color(a?.color, ACTOR_PALETTE[i % ACTOR_PALETTE.length]),
      type: typeof a?.type === 'string' ? a.type : null,
      // Trajectoire posee a la main. Presente, elle remplace l'itineraire
      // calcule sur le graphe de zones.
      waypoints:
        Array.isArray(a?.waypoints) && a.waypoints.length >= 2
          ? a.waypoints.map((w) => vec3(w)).map((w) => [w[0], 0, w[2]])
          : null,
    };
  });

  // --- Props -------------------------------------------------------------
  // Les ouvertures sont connues avant de placer les props : une porte se tient
  // entre deux zones, pas dans l'une d'elles.
  const doorways = buildZoneGraph(zones).doorways;

  const seenPropIds = new Set();
  const props = (Array.isArray(raw.props) ? raw.props : []).map((p, i) => {
    let id = typeof p?.id === 'string' && p.id.trim() ? p.id.trim() : `prop_${i + 1}`;
    while (seenPropIds.has(id)) id = `${id}_${i + 1}`;
    seenPropIds.add(id);
    const name = typeof p?.name === 'string' && p.name.trim() ? p.name.trim() : `Prop ${i + 1}`;
    const zoneId = typeof p?.zone === 'string' && zoneIds.has(p.zone) ? p.zone : zones[0].id;
    const zone = zones.find((z) => z.id === zoneId);
    const pos = vec3(p?.position, [zone.position[0], 0, zone.position[2]]);

    const declaredType = typeof p?.type === 'string' ? p.type.toLowerCase().trim() : null;
    const isDoor = declaredType === 'door' || /\b(door|porte|doorway|gate|portail)\b/i.test(name);
    let rotation = Number.isFinite(Number(p?.rotation)) ? Number(p.rotation) : 0;

    // Une porte appartient a une ouverture, pas a une piece. La rabattre dans
    // l'empreinte d'une zone la deposait au milieu du passage, en travers du
    // trajet camera. On l'aimante sur l'ouverture la plus proche.
    if (isDoor && doorways.length) {
      let best = null;
      for (const d of doorways) {
        const dist = Math.hypot(pos[0] - d.position[0], pos[2] - d.position[2]);
        if (!best || dist < best.dist) best = { d, dist };
      }
      if (best && best.dist <= DOOR_SNAP_RADIUS) {
        if (best.dist > 0.05) {
          warnings.push(`La porte "${name}" a ete recalee sur l'ouverture "${best.d.name}".`);
        }
        // Le battant s'ouvre en travers du passage : sa largeur suit l'axe
        // perpendiculaire a la marche.
        rotation = best.d.axis === 'z' ? 0 : Math.PI / 2;
        return {
          id,
          name,
          type: 'door',
          zone: zoneId,
          position: [best.d.position[0], 0, best.d.position[2]],
          rotation,
          scale: clamp(p?.scale, 0.2, 10, 1),
          color: color(p?.color, '#6A6E75'),
        };
      }
    }

    // Un prop pose hors de sa zone est ramene dans l'empreinte : le modele
    // confond parfois coordonnees locales et coordonnees monde.
    const f = zoneFootprint(zone);
    const isIn = (q) => q[0] >= f.minX && q[0] <= f.maxX && q[2] >= f.minZ && q[2] <= f.maxZ;
    const asLocal = [zone.position[0] + pos[0], pos[1], zone.position[2] + pos[2]];
    const finalPos = isIn(pos)
      ? pos
      : isIn(asLocal)
        ? asLocal
        : [
            Math.min(f.maxX - 0.5, Math.max(f.minX + 0.5, pos[0])),
            0,
            Math.min(f.maxZ - 0.5, Math.max(f.minZ + 0.5, pos[2])),
          ];
    if (!isIn(pos) && !isIn(asLocal)) {
      warnings.push(`L'objet "${name}" etait hors de "${zone.name}" : il y a ete ramene.`);
    }

    return {
      id,
      name,
      type: declaredType,
      zone: zoneId,
      position: [finalPos[0], 0, finalPos[2]],
      rotation,
      scale: clamp(p?.scale, 0.2, 10, 1),
      color: color(p?.color, '#6A6E75'),
    };
  });

  // --- Camera ------------------------------------------------------------
  const rawRig = typeof raw.camera?.rig === 'string' ? raw.camera.rig.toLowerCase().trim() : '';
  const rig = CAMERA_RIGS.includes(rawRig) ? rawRig : 'steadicam';
  if (rawRig && !CAMERA_RIGS.includes(rawRig)) {
    warnings.push(`Rig camera "${rawRig}" inconnu : repli sur "steadicam".`);
  }

  let target = raw.camera?.target;
  if (actors.length > 0 && !actors.some((a) => a.id === target)) {
    if (target) warnings.push(`La cible camera "${target}" n'existe pas : rattachee a "${actors[0].id}".`);
    target = actors[0].id;
  } else if (actors.length === 0) {
    target = null;
  }

  const camera = {
    rig,
    lens: clamp(raw.camera?.lens, 8, 300, 35),
    height: clamp(raw.camera?.height, 0.1, 60, 1.6),
    movement: typeof raw.camera?.movement === 'string' ? raw.camera.movement : 'follow',
    target,
    distance: clamp(raw.camera?.distance, 0.3, 100, 2),
    // Cles d'animation : posees a la main ou par l'auto-correction. Presentes,
    // elles remplacent la trajectoire calculee du rig.
    keys: normalizeKeys(raw.camera?.keys, project.duration),
  };

  // Les SceneGraph exportes avant l'unification portent des `waypoints`
  // spatiaux. On les convertit en cles pour qu'un projet ancien se recharge
  // sans perdre sa trajectoire corrigee.
  if (!camera.keys && Array.isArray(raw.camera?.waypoints) && raw.camera.waypoints.length >= 2) {
    camera.keys = normalizeKeys(
      waypointsToKeys(raw.camera.waypoints.map((w) => vec3(w)), project.duration),
      project.duration
    );
    warnings.push("Trajectoire camera importee : convertie en cles d'animation.");
  }

  // Modeles 3D generes par le modele, indexes par id d'entite. Conserves tels
  // quels : ils voyagent avec le SceneGraph a l'export comme a l'import.
  const models = {};
  if (raw.models && typeof raw.models === 'object') {
    const known = new Set([...actors.map((a) => a.id), ...props.map((p) => p.id)]);
    for (const [id, entry] of Object.entries(raw.models)) {
      if (!known.has(id) || !entry || typeof entry !== 'object') continue;
      models[id] = {
        three: typeof entry.three === 'string' ? entry.three : null,
        blender: typeof entry.blender === 'string' ? entry.blender : null,
        note: typeof entry.note === 'string' ? entry.note : '',
      };
    }
  }

  // Images de reference par element. Elles voyagent avec le SceneGraph, comme
  // les modeles : un projet exporte puis reimporte garde ses references.
  const refs = {};
  if (raw.refs && typeof raw.refs === 'object') {
    const known = new Set([
      ...actors.map((a) => a.id),
      ...props.map((p2) => p2.id),
      ...zones.map((z) => z.id),
    ]);
    for (const [id, entry] of Object.entries(raw.refs)) {
      if (!known.has(id) || !entry || typeof entry !== 'object') continue;
      if (typeof entry.url !== 'string' || !entry.url.trim()) continue;
      refs[id] = { url: entry.url.trim(), name: typeof entry.name === 'string' ? entry.name : '' };
    }
  }

  return { scene: { project, environment, zones, actors, props, camera, models, refs }, warnings };
}
