import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import apartment from '../fixtures/apartment.json';
import { normalizeSceneGraph } from './normalize.js';
import { solveScene } from './build.js';
import { samplePathAtT } from './paths.js';
import { makeKeyTrack, waypointsToKeys, cameraAtTime } from './camera.js';

const load = (mutate = () => {}) => {
  const raw = JSON.parse(JSON.stringify(apartment));
  mutate(raw);
  const { scene, warnings } = normalizeSceneGraph(raw);
  return { scene, warnings, solve: solveScene(scene) };
};

describe('trajectoires posees a la main', () => {
  const path = [
    [0, 0, 0],
    [0, 0, -6],
    [3, 0, -11],
    [7, 0, -13],
  ];

  it("remplace l'itineraire calcule", () => {
    const { solve } = load((r) => {
      r.actors[0].waypoints = path;
    });
    const entry = solve.actorPaths.get('actor_1');
    expect(entry.authored).toBe(true);
    expect(entry.route.authored).toBe(true);
    // La courbe doit passer par le premier et le dernier point poses.
    const start = samplePathAtT(entry.path, 0).position;
    const end = samplePathAtT(entry.path, 1).position;
    expect(start.distanceTo(new Vector3(0, 0, 0))).toBeLessThan(0.05);
    expect(end.distanceTo(new Vector3(7, 0, -13))).toBeLessThan(0.05);
  });

  it('ne teleporte pas davantage que le trajet calcule', () => {
    // La garantie vient de l'echantillonnage par longueur d'arc, pas de
    // l'origine des points : elle doit tenir sur un trajet pose a la main.
    const { scene, solve } = load((r) => {
      r.actors[0].waypoints = path;
    });
    const { duration, fps } = scene.project;
    const frames = Math.round(duration * fps);
    const entry = solve.actorPaths.get('actor_1');
    const budget = (entry.speed / fps) * 1.5 + 1e-6;

    let previous = samplePathAtT(entry.path, 0).position;
    let maxStep = 0;
    for (let f = 1; f <= frames; f += 1) {
      const current = samplePathAtT(entry.path, f / frames).position;
      maxStep = Math.max(maxStep, current.distanceTo(previous));
      previous = current;
    }
    expect(maxStep).toBeLessThan(budget);
  });

  it('ignore une trajectoire a un seul point', () => {
    const { scene } = load((r) => {
      r.actors[0].waypoints = [[0, 0, 0]];
    });
    expect(scene.actors[0].waypoints).toBeNull();
  });
});

describe("cles d'animation camera", () => {
  it('place la camera exactement sur ses cles', () => {
    // Le coeur du contrat : a l'instant d'une cle, la camera y est. Sinon poser
    // une cle ne veut rien dire.
    const keys = [
      { t: 0, position: [0, 1.6, 4] },
      { t: 6, position: [-3, 1.6, -6] },
      { t: 12, position: [5, 1.6, -12] },
    ];
    const track = makeKeyTrack(keys);
    for (const k of keys) {
      const p = track.positionAt(k.t);
      expect(p.distanceTo(new Vector3(...k.position))).toBeLessThan(0.01);
    }
  });

  it("n'amortit ni ne fait osciller une piste sur cles", () => {
    const { solve } = load((r) => {
      r.camera.keys = [
        { t: 0, position: [0, 1.6, 4] },
        { t: 12, position: [0, 1.6, -12] },
      ];
    });
    expect(solve.track.source).toBe('keyframed');
    // Trajectoire rectiligne : aucune deviation laterale ne doit apparaitre.
    const maxDrift = Math.max(...solve.track.positions.map((p) => Math.abs(p.x)));
    expect(maxDrift).toBeLessThan(0.01);
  });

  it('respecte une orientation imposee par les cles', () => {
    const { solve } = load((r) => {
      r.camera.keys = [
        { t: 0, position: [0, 1.6, 4], target: [10, 1.6, 4] },
        { t: 12, position: [0, 1.6, -12], target: [10, 1.6, -12] },
      ];
    });
    const first = solve.track.frames[0];
    expect(first.lookAt.x).toBeCloseTo(10, 1);
  });

  it('migre une trajectoire importee en waypoints vers des cles', () => {
    const { scene, warnings } = load((r) => {
      r.camera.waypoints = [
        [0, 1.6, 4],
        [0, 1.6, -4],
        [0, 1.6, -12],
      ];
    });
    expect(scene.camera.keys).not.toBeNull();
    expect(scene.camera.keys.length).toBeGreaterThanOrEqual(2);
    expect(scene.camera.keys[0].t).toBe(0);
    expect(scene.camera.keys.at(-1).t).toBeCloseTo(scene.project.duration, 3);
    expect(warnings.join(' ')).toMatch(/convertie en cles/);
  });

  it('conserve la geometrie lors de la conversion', () => {
    const wp = [
      [0, 1.6, 4],
      [2, 1.6, -4],
      [0, 1.6, -12],
    ];
    const keys = waypointsToKeys(wp, 12, 24);
    expect(keys[0].position[2]).toBeCloseTo(4, 1);
    expect(keys.at(-1).position[2]).toBeCloseTo(-12, 1);
    // Les instants couvrent toute la prise, dans l'ordre.
    expect(keys.every((k, i) => i === 0 || k.t > keys[i - 1].t)).toBe(true);
  });

  it('lit la piste a un instant quelconque', () => {
    const { solve, scene } = load();
    const mid = cameraAtTime(solve.track, scene.project.duration / 2);
    expect(mid.position).toBeInstanceOf(Vector3);
    expect(Number.isFinite(mid.position.x)).toBe(true);
  });
});
