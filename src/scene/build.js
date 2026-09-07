import { buildZoneGraph } from './graph.js';
import { buildActorPath } from './paths.js';
import { solveCameraTrack } from './camera.js';
import { buildColliders, sweepCamera } from './collision.js';

// Resolution complete d'un SceneGraph : geometrie, trajectoires, piste camera,
// collisions. Appelee a chaque modification de la scene. Tout ce qui suit est
// deterministe : deux appels sur la meme scene donnent le meme resultat, ce qui
// rend la detection de collision reproductible et le scrub exact.

/**
 * @param {object} scene SceneGraph normalise
 * @returns {object} solve
 */
export function solveScene(scene) {
  const warnings = [];
  const graph = buildZoneGraph(scene.zones);

  if (scene.zones.length > 1 && graph.doorways.length === 0) {
    warnings.push(
      "Aucune zone n'est adjacente : les personnages emprunteront des trajets directs plutot que des passages."
    );
  }

  const actorPaths = new Map();
  scene.actors.forEach((actor, index) => {
    const result = buildActorPath(actor, scene.zones, graph, scene.project.duration, index);
    if (result.warning) warnings.push(result.warning);
    actorPaths.set(actor.id, result);
  });

  const track = solveCameraTrack(scene, actorPaths);
  const colliders = buildColliders(scene, graph);
  const collision = sweepCamera(track, colliders);

  return {
    graph,
    actorPaths,
    track,
    colliders,
    collision,
    warnings,
    frameCount: track.frames.length,
  };
}
