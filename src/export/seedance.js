import { lensToFov } from '../scene/camera.js';
import { inferActorType } from '../proxies/registry.js';

// Export "prompt Seedance 2.5".
//
// Le blocking contient deja tout ce qu'un prompt video a besoin de savoir :
// duree, decoupage en pieces, instants de franchissement, focale, rig, hauteur,
// distance au sujet, vitesse de marche. On le redige en anglais, sous la forme
// d'un brief de tournage, plutot que de laisser l'utilisateur redecrire a la
// main ce que l'outil a deja calcule.

const sec = (t) => `${t.toFixed(2)}`;

const RIG_LANGUAGE = {
  steadicam:
    'Steadicam. Smooth stabilised movement with a slight operator lag through turns. No gimbal float, no drone behaviour.',
  handheld:
    'Handheld. Live operator weight, restrained micro-jitter, natural breathing. Never shaky-cam or whip pans.',
  static: 'Locked-off camera on sticks. The frame does not move; only the subject moves inside it.',
  dolly: 'Dolly on track. Constant-velocity lateral translation, no acceleration ramps, no zoom.',
  crane: 'Crane / jib. Continuous descending arc, motivated and smooth, no sudden altitude changes.',
};

const speedWord = (v) => {
  if (v < 0.9) return 'a slow, deliberate walk';
  if (v < 1.5) return 'a natural walking pace';
  if (v < 2.1) return 'a brisk walk';
  return 'a fast, urgent walk';
};

/**
 * Decoupe la prise en beats a partir des franchissements de porte du sujet
 * suivi : ce sont les vrais points de bascule dramatique de la scene.
 */
function buildBeats(scene, solve) {
  const targetId = scene.camera.target;
  const entry = targetId ? solve.actorPaths.get(targetId) : null;
  const duration = scene.project.duration;
  const zoneName = (id) => scene.zones.find((z) => z.id === id)?.name || 'the set';

  if (!entry || !entry.route || entry.route.zones.length < 2) {
    return [
      {
        from: 0,
        to: duration,
        zone: zoneName(entry?.route?.zones?.[0] || scene.zones[0].id),
        door: null,
      },
    ];
  }

  const beats = [];
  let cursor = 0;
  entry.route.zones.forEach((zoneId, i) => {
    const crossing = entry.doorTimes[i];
    const to = crossing ? crossing.time : duration;
    beats.push({ from: cursor, to, zone: zoneName(zoneId), door: crossing?.doorway.name || null });
    cursor = to;
  });
  return beats.filter((b) => b.to - b.from > 0.05);
}

/**
 * @param {object} scene SceneGraph normalise
 * @param {object} solve resultat de solveScene
 * @param {string} [brief] description d'origine saisie par l'utilisateur
 * @param {{ withReferenceVideos?: boolean, referenceCount?: number,
 *          referenceImages?: {label:string, kind:string}[] }} [options]
 * @returns {string} prompt Seedance 2.5, en anglais
 */
export function buildSeedancePrompt(scene, solve, brief = '', options = {}) {
  const { project, camera, environment } = scene;
  const target = scene.actors.find((a) => a.id === camera.target);
  const targetEntry = target ? solve.actorPaths.get(target.id) : null;
  const beats = buildBeats(scene, solve);
  const fov = lensToFov(camera.lens);
  const interior = environment.type === 'interior';

  const others = scene.actors.filter((a) => a.id !== camera.target);

  const lines = [];
  const push = (...xs) => lines.push(...xs);

  // --- En-tete ------------------------------------------------------------
  push(
    'TITLE:',
    project.name.toUpperCase(),
    '',
    'DURATION:',
    `${project.duration} seconds, ${project.fps} fps.`,
    '',
    'FORMAT:',
    `${project.aspectRatio}. Keep every critical subject and action inside a centred safe area so the shot can be reframed.`,
    '',
    'GENRE:',
    interior
      ? 'Grounded cinematic narrative. Photorealistic interior. Contemporary, restrained, not science-fiction.'
      : 'Grounded cinematic narrative. Photorealistic exterior. Natural light, contemporary, documentary-adjacent realism.',
    ''
  );

  if (brief.trim()) {
    push('ORIGINAL SCENE BRIEF:', `"${brief.trim()}"`, '');
  }

  // --- Consigne de reference ---------------------------------------------
  // Quand les passes de blocking sont jointes, il faut lever l'ambiguite : ces
  // clips decrivent la mise en place, pas le rendu. Sans cette consigne le
  // modele imite l'aspect gris des proxys.
  if (options.withReferenceVideos) {
    push(
      'HOW TO USE THE ATTACHED REFERENCE VIDEOS — READ THIS FIRST:',
      `${options.referenceCount || 2} reference clips are attached. They are 3D BLOCKING PREVIZ, not a look reference.`,
      'One clip is an isometric overview of the set showing the rooms, the character paths and the camera trajectory.',
      'One clip is the camera POV: exactly what the lens sees, frame by frame, for the whole take.',
      '',
      'FOLLOW from the references:',
      '- the camera trajectory, its speed, its height and its timing, frame for frame;',
      '- the position and path of every character at every moment;',
      '- the layout of the set, the placement of doorways, and which room the camera is in at each second;',
      '- the exact duration and the moment of each room-to-room transition.',
      '',
      'DO NOT REPRODUCE from the references:',
      '- the grey untextured proxy look, the coloured cylinders, the flat shading;',
      '- the wireframe outlines, the floating labels, the transparent walls, the trajectory ribbons;',
      '- the empty backgrounds and the missing set dressing.',
      '',
      'Render the scene photorealistically: real people with faces, clothing and weight, real materials, real',
      'lighting, a fully dressed set. The blocking is the skeleton; you are adding the photography.',
      ''
    );
  }

  // --- Images de reference ------------------------------------------------
  // L'API ne recoit qu'une liste plate d'URL : sans cette section, le modele ne
  // saurait pas qu'une image donnee represente tel personnage ou telle piece.
  // La numerotation suit l'ordre exact du tableau envoye.
  const refs = options.referenceImages || [];
  if (refs.length) {
    push('REFERENCE IMAGES:');
    refs.forEach((r, i) => {
      const what =
        r.kind === 'actor'
          ? `${r.label.toUpperCase()}. Match this person's appearance, wardrobe and build.`
          : r.kind === 'zone'
            ? `the ${r.label.toUpperCase()}. Match its architecture, materials and set dressing.`
            : `${r.label.toUpperCase()}. Match this object's design, material and colour.`;
      push(`Reference image ${i + 1} shows ${what}`);
    });
    push(
      '',
      'These images define look, not staging. Take the appearance from them and the movement from the video references.',
      ''
    );
  }

  // --- Camera -------------------------------------------------------------
  push(
    'CAMERA — THIS IS THE SPINE OF THE SHOT:',
    RIG_LANGUAGE[camera.rig] || RIG_LANGUAGE.steadicam,
    `Lens: ${camera.lens}mm spherical (approximately ${fov.toFixed(1)} degrees vertical field of view on a 35mm full-frame sensor).`,
    `Camera height: ${camera.height.toFixed(2)} m from the floor, held constant.`,
    target
      ? `The camera follows ${target.name} continuously, staying approximately ${camera.distance.toFixed(
          1
        )} m behind the subject. It never overtakes them and never cuts away.`
      : 'The camera holds the set without a specific subject to follow.',
    '',
    'ONE UNINTERRUPTED TAKE. No cuts, no hidden cuts, no speed ramps, no artificial zoom.',
    'All apparent approach comes from the camera physically translating through space.',
    'Use realistic inertia. No camera teleportation. No unexplained lens change.',
    ''
  );

  if (camera.keys) {
    push(
      'NOTE ON CAMERA PATH:',
      'The trajectory has been corrected to clear set geometry. The camera passes through every doorway centred in the opening, never clipping a frame or a wall.',
      ''
    );
  }

  // --- Decor --------------------------------------------------------------
  push('SET — THE CAMERA TRAVELS THROUGH THESE SPACES IN ORDER:');
  beats.forEach((b, i) => {
    push(`${i + 1}. ${b.zone}${b.door ? ` — exits through the ${b.door.replace(/ Doorframe$/, '')} doorway` : ''}`);
  });
  push(
    '',
    'The spaces must remain geographically coherent: same architecture, same continuous floor, no morphing, no duplicated rooms.',
    ''
  );

  // --- Decoupage ----------------------------------------------------------
  push('BEAT BREAKDOWN:', '');
  beats.forEach((b, i) => {
    push(`${sec(b.from)}–${sec(b.to)} SEC`);
    if (target) {
      push(
        `${target.name} moves through the ${b.zone} at ${speedWord(targetEntry?.speed || 1.2)}${
          i === 0 ? ', entering frame already in motion' : ''
        }.`
      );
    }
    push(
      `Camera stays ${camera.distance.toFixed(1)} m behind, ${camera.height.toFixed(2)} m high, ${camera.lens}mm.`
    );
    if (b.door) {
      push(
        `At approximately ${sec(b.to)} sec the subject passes through the ${b.door.replace(
          / Doorframe$/,
          ''
        )} doorway. The camera follows through the same opening, centred, without touching the frame.`
      );
    }
    push('');
  });

  // --- Personnages --------------------------------------------------------
  push('CHARACTERS:', '');
  scene.actors.forEach((a) => {
    const entry = solve.actorPaths.get(a.id);
    const isTarget = a.id === camera.target;
    push(
      `${a.name.toUpperCase()}${isTarget ? ' (SUBJECT — the camera follows this person)' : ''}`,
      `Approximately ${a.height.toFixed(2)} m tall. ${
        inferActorType(a) === 'human' ? 'A single, consistent human being.' : ''
      }`,
      a.action ? `Action: ${a.action}.` : 'Action: crosses the space.',
      `Covers about ${entry?.path.length.toFixed(1) || 0} m over the take, at ${speedWord(entry?.speed || 1.2)} (${(
        entry?.speed || 0
      ).toFixed(2)} m/s).`,
      'Movement is continuous from first to last frame. They never teleport, never snap to a new position, never freeze.',
      ''
    );
  });

  if (others.length) {
    push(
      'Background characters keep their own continuous paths and must not collide with the subject or with the camera.',
      ''
    );
  }

  // --- Lumiere ------------------------------------------------------------
  push(
    'LIGHTING:',
    interior
      ? 'Motivated practical lighting. Soft key from windows around 5600K, warm practicals around 3200K, controlled negative fill. Natural skin tones, refined contrast, deep but readable shadows.'
      : 'Natural daylight, consistent direction and colour temperature for the whole take. Soft ambient bounce, no artificial rim, no time-of-day change mid-shot.',
    'The exposure and colour temperature must not shift during the take unless the subject physically moves between lighting zones.',
    ''
  );

  // --- Verrous de continuite ---------------------------------------------
  push(
    'CONTINUITY LOCKS:',
    'Preserve the same characters, same wardrobe, same faces from the first to the last frame.',
    'Preserve the architecture and the direction of travel throughout.',
    'The camera-to-subject relationship stays consistent for the whole take.',
    'No duplicated people. No duplicated rooms or landmarks. No sudden change of daylight.',
    ''
  );

  // --- Contraintes negatives ---------------------------------------------
  push(
    'NEGATIVE CONSTRAINTS:',
    'No cuts during the take. No camera teleportation. No unexplained camera orbit.',
    'No artificial zoom. No speed ramping. No impossible instantaneous acceleration.',
    'No characters teleporting, sliding, or snapping between positions. No feet skating on the floor.',
    'No fisheye distortion. No morphing architecture. No duplicated buildings or doorways.',
    'No distorted faces. No duplicated people. No wardrobe morphing. No floating objects.',
    'No fake or unreadable on-screen text. No gibberish typography.',
    'No excessive holograms, no cyberpunk look, no neon overload, no generic sci-fi interfaces.',
    'No excessive teal-and-orange grading.'
  );

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
