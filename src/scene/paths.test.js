import { describe, it, expect } from 'vitest';
import restaurant from '../fixtures/restaurant.json';
import street from '../fixtures/street.json';
import { normalizeSceneGraph, zoneFootprint } from './normalize.js';
import { solveScene } from './build.js';
import { samplePathAtT } from './paths.js';

const solveFixture = (fixture) => {
  const { scene } = normalizeSceneGraph(fixture);
  return { scene, solve: solveScene(scene) };
};

describe('normalisation', () => {
  it('conserve le SceneGraph de reference tel quel', () => {
    const { scene } = normalizeSceneGraph(restaurant);
    expect(scene.zones.map((z) => z.id)).toEqual(['zone_1', 'zone_2', 'zone_3']);
    expect(scene.zones.map((z) => z.position[2])).toEqual([0, -8, -18]);
    expect(scene.camera.target).toBe('actor_1');
    expect(scene.project.fps).toBe(24);
  });

  it('ecarte les zones superposees', () => {
    const { scene, warnings } = normalizeSceneGraph({
      ...restaurant,
      zones: [
        { id: 'a', name: 'A', width: 10, depth: 10, height: 3, color: '#222222', position: [0, 0, 0] },
        { id: 'b', name: 'B', width: 10, depth: 10, height: 3, color: '#222222', position: [0, 0, -2] },
      ],
      actors: [{ id: 'actor_1', name: 'X', height: 1.7, startZone: 'a', endZone: 'b', action: '', color: '#F27D26' }],
    });
    const [fa, fb] = scene.zones.map(zoneFootprint);
    const overlapZ = Math.min(fa.maxZ, fb.maxZ) - Math.max(fa.minZ, fb.minZ);
    expect(overlapZ).toBeLessThanOrEqual(0);
    expect(warnings.join(' ')).toMatch(/chevauchaient/);
  });

  it('rattache une reference de zone cassee au lieu de planter', () => {
    const { scene, warnings } = normalizeSceneGraph({
      ...restaurant,
      actors: [
        { id: 'actor_1', name: 'X', height: 1.7, startZone: 'nope', endZone: 'zone_3', action: '', color: '#F27D26' },
      ],
    });
    expect(scene.actors[0].startZone).toBe('zone_1');
    expect(warnings.join(' ')).toMatch(/inexistante/);
  });
});

describe('graphe de zones', () => {
  it('relie les trois pieces du restaurant et nomme les encadrements', () => {
    const { solve } = solveFixture(restaurant);
    const names = solve.graph.doorways.map((d) => d.name);
    // La zone 2 touche la zone 1 (ecart 0) et la zone 3 est a 1 m : les deux
    // liaisons doivent exister malgre l'ecart.
    expect(names).toContain('Main Dining Room Doorframe');
    expect(names).toContain('Kitchen Doorframe');
  });

  it("fait transiter la femme par la salle avant la cuisine", () => {
    const { solve } = solveFixture(restaurant);
    const route = solve.actorPaths.get('actor_1').route;
    expect(route.zones).toEqual(['zone_1', 'zone_2', 'zone_3']);
  });
});

describe('continuite des deplacements (aucune teleportation)', () => {
  it.each([
    ['restaurant', restaurant],
    ['street', street],
  ])('%s : le pas image par image reste borne par la vitesse', (_label, fixture) => {
    const { scene, solve } = solveFixture(fixture);
    const { duration, fps } = scene.project;
    const frames = Math.round(duration * fps);

    for (const actor of scene.actors) {
      const { path, speed } = solve.actorPaths.get(actor.id);
      const budget = (speed / fps) * 1.5 + 1e-6; // marge pour l'echantillonnage

      let previous = samplePathAtT(path, 0).position;
      let maxStep = 0;
      for (let f = 1; f <= frames; f += 1) {
        const current = samplePathAtT(path, f / frames).position;
        maxStep = Math.max(maxStep, current.distanceTo(previous));
        previous = current;
      }
      expect(maxStep, `${actor.name} saute de ${maxStep.toFixed(3)} m en une image`).toBeLessThan(budget);
    }
  });

  it('un acteur qui reste dans sa zone se deplace quand meme', () => {
    const { solve } = solveFixture(restaurant);
    // Le serveur a startZone === endZone : il doit traverser, pas rester plante.
    const waiter = solve.actorPaths.get('actor_2');
    expect(waiter.path.length).toBeGreaterThan(2);
  });

  it('la camera avance sans saut entre deux images', () => {
    const { scene, solve } = solveFixture(restaurant);
    const dt = scene.project.duration / (solve.track.frames.length - 1);
    let maxStep = 0;
    for (let i = 1; i < solve.track.positions.length; i += 1) {
      maxStep = Math.max(maxStep, solve.track.positions[i].distanceTo(solve.track.positions[i - 1]));
    }
    // 8 m/s serait deja une camera de course : au-dela c'est un saut.
    expect(maxStep).toBeLessThan(8 * dt);
  });
});

describe('determinisme', () => {
  it('deux resolutions de la meme scene donnent la meme piste camera', () => {
    const a = solveFixture(restaurant).solve;
    const b = solveFixture(restaurant).solve;
    expect(a.track.positions.length).toBe(b.track.positions.length);
    a.track.positions.forEach((p, i) => {
      expect(p.distanceTo(b.track.positions[i])).toBeLessThan(1e-9);
    });
  });
});
