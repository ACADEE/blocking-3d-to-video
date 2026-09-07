// Le prompt de parsing est repris quasi mot pour mot de celui retrouve dans la
// reponse kie.ai de reference (tempfile 1788709071900-nstbfll41vf.json). Il est
// prouve fonctionnel : on ne le reecrit pas, on l'etend seulement du tableau
// "props" qui permet aux objets (voitures, arbres, tables...) d'entrer en scene.

export const PROP_TYPES = [
  'car',
  'truck',
  'bike',
  'table',
  'chair',
  'tree',
  'plant',
  'lamp',
  'crate',
  'door',
  'desk',
  'sofa',
  'generic',
];

export function buildScenePrompt({ description, duration, fps, aspectRatio }) {
  return `
You are an expert film director and 3D blocking artist.
Parse the following scene description into a structured JSON SceneGraph.
The scene description might dictate elements like the location (e.g. restaurant, kitchen, street), characters, objects and camera movements.
If the description doesn't mention something, do not invent it (e.g., if there's no kitchen mentioned, don't add a kitchen zone).

Rules:
- Return ONLY valid JSON.
- Break the scene into logical 'zones' (rooms/areas). Ensure their 'position' [x, y, z] values are spread out logically so they don't overlap (e.g., [0,0,0] for main room, [0,0,-8] for next room).
- Zones must be laid out so that consecutive zones are adjacent or separated by at most 2 units, so characters can physically walk from one to the next.
- Map characters to 'actors'. Set their 'startZone' and 'endZone' to the EXACT 'id' of the generated zones.
- Map inanimate objects explicitly mentioned in the description to 'props'. Each prop's 'zone' must be the EXACT 'id' of a generated zone, and its 'position' [x, y, z] must lie inside that zone's footprint. Use y = 0 (props sit on the floor).
- Allowed prop 'type' values: ${PROP_TYPES.join(', ')}. Use 'generic' when nothing else fits.
- Do NOT create props that are not mentioned in the description. If no objects are described, return an empty 'props' array.
- Extract EVERY physical element the description names: characters, furniture, vehicles, vegetation, and doors. A named door ("heavy glass entrance door", "swinging kitchen doors") is a prop of type 'door' and must appear in 'props'.
- A door prop separates two rooms: place it ON THE BOUNDARY between the two zones it connects, centred on their shared edge, not inside a room. Its 'zone' should be the room the character leaves.
- Set the 'camera' rig, lens, movement, and target based on the description. The camera target MUST exactly match an actor's 'id'.
- Allowed camera 'rig' values: steadicam, handheld, static, dolly, crane.
- Do NOT return markdown formatting (no \`\`\`json). Just the raw JSON string.

Scene Description: "${description}"
Requested Duration: ${duration}
Requested Aspect Ratio: ${aspectRatio}
Requested FPS: ${fps}

Expected JSON Schema exactly matching this structure:
{
  "project": { "name": "Generated Scene", "duration": ${duration}, "fps": ${fps}, "aspectRatio": "${aspectRatio}" },
  "environment": { "type": "interior" },
  "zones": [
    { "id": "zone_1", "name": "Main Hall", "width": 10, "depth": 10, "height": 3, "color": "#2A2A2A", "position": [0,0,0] }
  ],
  "actors": [
    { "id": "actor_1", "name": "Protagonist", "height": 1.7, "startZone": "zone_1", "endZone": "zone_1", "action": "walk", "color": "#F27D26" }
  ],
  "props": [
    { "id": "prop_1", "name": "Parked Car", "type": "car", "zone": "zone_1", "position": [3,0,2], "rotation": 0, "color": "#8A2F3A" }
  ],
  "camera": { "rig": "steadicam", "lens": 35, "height": 1.6, "movement": "follow", "target": "actor_1", "distance": 2 }
}
`.trim();
}

// Prompt d'auto-correction. On fournit au modele la geometrie reelle : l'AABB de
// l'obstacle percute, les ouvertures disponibles, et la trajectoire de l'acteur
// suivi. On lui demande une polyligne de waypoints, pas une prose.
export function buildCorrectionPrompt({ camera, collision, obstacles, doorways, targetPath, duration }) {
  const fmt = (v) => v.map((n) => Number(n.toFixed(2)));
  return `
You are a camera-blocking technical director. A virtual camera trajectory collides with set geometry. Produce a corrected trajectory.

COORDINATE SYSTEM: Y is up, units are meters. The floor is y = 0.

CURRENT CAMERA:
${JSON.stringify(camera)}

COLLISION DETECTED:
At ${collision.timecode} (frame ${collision.frame} of ${Math.round(duration * camera.fps || 0)}) the camera sphere (radius 0.35 m) intersects "${collision.obstacleName}".
Camera position at impact: [${fmt(collision.position).join(', ')}]

BLOCKING OBSTACLES (axis-aligned bounding boxes, min/max corners):
${obstacles.map((o) => `- "${o.name}": min [${fmt(o.min).join(', ')}] max [${fmt(o.max).join(', ')}]`).join('\n')}

AVAILABLE OPENINGS (the camera must pass through these, centered):
${doorways.map((d) => `- "${d.name}": center [${fmt(d.position).join(', ')}], clear width ${d.width.toFixed(2)} m, axis ${d.axis}`).join('\n')}

TARGET ACTOR TRAJECTORY (sampled, the camera should keep framing this subject):
${targetPath.map((p) => `[${fmt(p).join(', ')}]`).join(' -> ')}

TASK:
Return a corrected camera path as an ordered list of waypoints. Constraints:
- Every waypoint must keep a clearance of at least 0.45 m from every obstacle AABB listed above.
- Waypoints passing between rooms MUST be centered on the corresponding opening.
- Keep the camera height close to ${camera.height} m and keep it behind the subject; do not overtake the actor.
- The path must stay smooth and continuous. Do not create sharp reversals or jumps.
- Use between 4 and 12 waypoints.

Return ONLY valid JSON, no markdown fences, exactly this shape:
{ "rig": "${camera.rig}", "lens": ${camera.lens}, "height": ${camera.height}, "distance": ${camera.distance}, "target": "${camera.target}", "waypoints": [[x,y,z], [x,y,z]], "note": "one short sentence explaining the correction" }
`.trim();
}

/**
 * Prompt de modelisation. GPT-6 Astra ecrit la geometrie elle-meme, au lieu de
 * se limiter au SceneGraph : on lui impose le gabarit deja calcule par l'app,
 * pour que le modele detaille remplace le proxy sans casser ni le cadrage ni la
 * detection de collision.
 *
 * @param {{ entity: object, bounds: {width:number,height:number,depth:number},
 *           target: 'three'|'blender', context?: string }} opts
 */
export function buildModelPrompt({ entity, bounds, target, context = '' }) {
  const shared = `
Object to model: "${entity.name}"${entity.type ? ` (type: ${entity.type})` : ''}.
${entity.action ? `It is doing: ${entity.action}.` : ''}
${context ? `Scene context: ${context}` : ''}

HARD SIZE CONSTRAINT — the model must fit exactly inside this bounding box, in meters:
  width  (X) = ${bounds.width.toFixed(2)}
  height (Y, up) = ${bounds.height.toFixed(2)}
  depth  (Z) = ${bounds.depth.toFixed(2)}
The object sits on the ground: its lowest point is at Y = 0 and it is centred on X = 0 and Z = 0.
Its front faces +Z.

STYLE: clean low-poly previz geometry built from primitives. Readable silhouette over surface detail.
Aim for 8 to 30 primitives. No textures, no images, no external assets, no network access.
Base colour to use: ${entity.color || '#8A8F98'}.
`.trim();

  if (target === 'blender') {
    return `
You are a technical artist writing Blender Python. Model one object with bpy primitives.

${shared}

Write ONE Python function with exactly this signature:

def build(name, mat):
    """Return a list of the created bpy objects, all positioned in LOCAL space
    (origin at the object's base centre, +Z up in Blender, front facing +Y)."""

IMPORTANT — Blender is Z-up while the constraint above is given Y-up.
Map it as: box width -> X, box depth -> Y, box height -> Z. Front faces +Y in Blender.

Rules:
- Use only bpy.ops.mesh.primitive_* (cube, uv_sphere, cylinder, cone, torus) and object transforms.
- Assign the passed "mat" to every created object via obj.data.materials.append(mat).
- Name each object with the "name" prefix, e.g. name + "_body".
- Do NOT link objects to collections, do NOT touch the scene, do NOT import anything.
- Do NOT call bpy.ops.object.delete or select_all.
- Return the list of created objects.

Return ONLY the function source code. No markdown fences, no explanation, no imports.
`.trim();
  }

  return `
You are a technical artist writing three.js. Model one object from primitives.

${shared}

Write ONE JavaScript function with exactly this signature:

function build(THREE, color) {
  // returns a THREE.Group
}

Rules:
- Use ONLY THREE.Group, THREE.Mesh, THREE.MeshStandardMaterial and these geometries:
  BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, CircleGeometry, PlaneGeometry.
- Y is up. The group's origin is at the base centre: nothing may go below y = 0.
- Use flatShading: true on materials. Derive shades from "color" with .clone().offsetHSL() or a hex literal.
- No imports, no require, no fetch, no eval, no window/document/globalThis access, no timers, no loops above 200 iterations.
- Return the group.

Return ONLY the function source code. No markdown fences, no explanation.
`.trim();
}

/**
 * Prompt d'edition de scene.
 *
 * On demande un PATCH, pas un SceneGraph complet : un graphe entier ecraserait
 * les trajectoires et les positions que l'utilisateur vient de regler a la main.
 * Ajouter une voiture ne doit pas defaire une heure de blocking.
 */
export function buildEditPrompt({ scene, instruction }) {
  const summary = {
    zones: scene.zones.map((z) => ({
      id: z.id,
      name: z.name,
      width: z.width,
      depth: z.depth,
      position: z.position.map((n) => Number(n.toFixed(2))),
    })),
    actors: scene.actors.map((a) => ({ id: a.id, name: a.name, startZone: a.startZone, endZone: a.endZone })),
    props: (scene.props || []).map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      zone: p.zone,
      position: p.position.map((n) => Number(n.toFixed(2))),
    })),
  };

  return `
You are editing an existing 3D blocking scene. Apply one instruction and return ONLY the change.

CURRENT SCENE (y is up, metres, zone 'position' is the floor centre):
${JSON.stringify(summary, null, 1)}

INSTRUCTION: "${instruction}"

Return a PATCH, not a full scene. Anything you do not mention is left untouched — this matters,
because the user may have hand-edited paths and positions that a full rewrite would destroy.

Rules:
- New ids must not collide with existing ones.
- A new prop needs: id, name, type, zone (an existing zone id), position [x,y,z] inside that zone's
  footprint in WORLD coordinates, rotation (radians), color (#rrggbb).
- Allowed prop types: ${PROP_TYPES.join(', ')}.
- A door prop belongs ON THE BOUNDARY between two zones, never inside a room.
- A new actor needs: id, name, height, startZone, endZone, action, color.
- A new zone needs: id, name, width, depth, height, color, position — placed adjacent to an existing
  zone (touching or within 2 units) so characters can walk there.
- "update" entries carry an id plus only the fields that change.
- "remove" is a list of ids.
- If the instruction cannot be applied, return every list empty and explain in "note".

Return ONLY valid JSON, no markdown fences, exactly this shape:
{ "add": { "zones": [], "actors": [], "props": [] },
  "update": [],
  "remove": [],
  "note": "one short sentence describing what you did" }
`.trim();
}
