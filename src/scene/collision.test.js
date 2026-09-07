import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import restaurant from '../fixtures/restaurant.json';
import { normalizeSceneGraph } from './normalize.js';
import { solveScene } from './build.js';
import { buildColliders, sweepCamera, formatTimecode, CAMERA_RADIUS } from './collision.js';
import { buildZoneGraph } from './graph.js';
import { relaxTrajectory } from './autocorrect.js';

describe('timecode', () => {
  it('formate en MM:SS', () => {
    expect(formatTimecode(9)).toBe('00:09');
    expect(formatTimecode(75.4)).toBe('01:15');
  });
});

describe('balayage de collision', () => {
  it('detecte un mur synthetique a la bonne image et le nomme', () => {
    // Camera qui avance en ligne droite sur +Z, mur en travers a z = 5.
    const fps = 24;
    const duration = 10;
    const frameCount = duration * fps + 1;
    const frames = [];
    for (let i = 0; i < frameCount; i += 1) {
      const z = (i / (frameCount - 1)) * 10; // 0 -> 10 m
      frames.push({ position: new Vector3(0, 1.6, z), lookAt: new Vector3(0, 1.6, z + 1) });
    }
    const track = { frames, positions: frames.map((f) => f.position), duration, fps };

    const wall = {
      id: 'w1',
      name: 'Kitchen Doorframe',
      kind: 'doorframe',
      min: [-2, 0, 4.9],
      max: [2, 3, 5.1],
    };

    const result = sweepCamera(track, [wall]);
    expect(result.first).not.toBeNull();
    expect(result.first.obstacleName).toBe('Kitchen Doorframe');
    // Le contact commence des que la sphere touche la face avant du mur.
    const impactZ = result.first.position.z;
    expect(impactZ).toBeGreaterThan(4.9 - CAMERA_RADIUS - 0.06);
    expect(impactZ).toBeLessThanOrEqual(4.9 + 1e-6);
    expect(result.first.timecode).toMatch(/^\d{2}:\d{2}$/);
  });

  it('ne signale rien quand la trajectoire est degagee', () => {
    const frames = [
      { position: new Vector3(0, 1.6, 0), lookAt: new Vector3(0, 1.6, 1) },
      { position: new Vector3(0, 1.6, 1), lookAt: new Vector3(0, 1.6, 2) },
    ];
    const track = { frames, positions: frames.map((f) => f.position), duration: 1, fps: 24 };
    const far = { id: 'x', name: 'Far Wall', kind: 'wall', min: [50, 0, 50], max: [51, 3, 51] };
    expect(sweepCamera(track, [far]).first).toBeNull();
  });
});

describe('geometrie du decor', () => {
  it("perce les murs a l'emplacement des ouvertures", () => {
    const { scene } = normalizeSceneGraph(restaurant);
    const graph = buildZoneGraph(scene.zones);
    const colliders = buildColliders(scene, graph);

    const kitchenDoor = graph.doorways.find((d) => d.name === 'Kitchen Doorframe');
    expect(kitchenDoor).toBeTruthy();

    // Le centre de l'ouverture, a hauteur de rig, doit etre libre.
    const center = new Vector3(kitchenDoor.position[0], 1.2, kitchenDoor.position[2]);
    const blocking = colliders.filter((c) => {
      const cp = new Vector3(
        Math.min(c.max[0], Math.max(c.min[0], center.x)),
        Math.min(c.max[1], Math.max(c.min[1], center.y)),
        Math.min(c.max[2], Math.max(c.min[2], center.z))
      );
      return cp.distanceTo(center) < 0.01;
    });
    expect(blocking).toHaveLength(0);
  });

  it('genere des montants nommes d\'apres la piece traversee', () => {
    const { scene } = normalizeSceneGraph(restaurant);
    const graph = buildZoneGraph(scene.zones);
    const colliders = buildColliders(scene, graph);
    const names = new Set(colliders.filter((c) => c.kind === 'doorframe').map((c) => c.name));
    expect(names.has('Kitchen Doorframe')).toBe(true);
  });
});

describe('auto-correction locale', () => {
  it('degage une trajectoire qui traverse un montant', () => {
    const { scene } = normalizeSceneGraph(restaurant);
    const graph = buildZoneGraph(scene.zones);
    const colliders = buildColliders(scene, graph);
    const door = graph.doorways.find((d) => d.name === 'Kitchen Doorframe');

    // Trajectoire volontairement decalee : elle vise le montant, pas l'ouverture.
    const offset = door.width / 2 + 0.15;
    const positions = [];
    for (let i = 0; i <= 60; i += 1) {
      const u = i / 60;
      positions.push(new Vector3(door.position[0] + offset, 1.6, door.position[2] + 4 - u * 8));
    }

    const before = sweepCamera(
      { frames: positions.map((p) => ({ position: p, lookAt: p })), positions, duration: 2.5, fps: 24 },
      colliders
    );
    expect(before.first).not.toBeNull();

    const { points, resolved } = relaxTrajectory(positions, colliders, graph.doorways, 1.6);
    const after = sweepCamera(
      { frames: points.map((p) => ({ position: p, lookAt: p })), positions: points, duration: 2.5, fps: 24 },
      colliders
    );

    expect(resolved).toBe(true);
    expect(after.first).toBeNull();
  });
});

describe('scene de reference', () => {
  it('se resout de bout en bout sans erreur', () => {
    const { scene } = normalizeSceneGraph(restaurant);
    const solve = solveScene(scene);
    expect(solve.track.frames.length).toBe(15 * 24 + 1);
    expect(solve.colliders.length).toBeGreaterThan(0);
    expect(solve.actorPaths.size).toBe(2);
  });
});

describe('auto-correction en boucle fermee', () => {
  it("degage reellement la scene en L, verification faite dans la representation finale", async () => {
    const apartment = (await import('../fixtures/apartment.json')).default;
    const { localAutoCorrect } = await import('./autocorrect.js');
    const { scene } = normalizeSceneGraph(apartment);
    const solve = solveScene(scene);

    // La scene de demonstration doit vraiment produire un contact : si ce test
    // casse, c'est la geometrie du decor qui a bouge, pas le detecteur.
    expect(solve.collision.hits.length).toBeGreaterThan(0);
    expect(solve.collision.worst.obstacleName).toBe('Kitchen Doorframe');

    const fix = localAutoCorrect({
      scene,
      actorPaths: solve.actorPaths,
      track: solve.track,
      colliders: solve.colliders,
      graph: solve.graph,
    });

    expect(fix.resolved).toBe(true);
    expect(fix.sweep.hits).toHaveLength(0);
  });
});

describe('exterieur', () => {
  it("ne ceinture pas les zones de murs et ne garde que les objets", async () => {
    const street = (await import('../fixtures/street.json')).default;
    const { scene } = normalizeSceneGraph(street);
    const solve = solveScene(scene);

    expect(scene.environment.type).toBe('exterior');
    expect(solve.colliders.filter((c) => c.kind === 'wall')).toHaveLength(0);
    expect(solve.colliders.filter((c) => c.kind === 'doorframe')).toHaveLength(0);
    // Les props restent bloquants : un camion arrete une camera.
    expect(solve.colliders.map((c) => c.name)).toContain('Delivery Truck');
  });

  it('conserve les murs en interieur', () => {
    const { scene } = normalizeSceneGraph(restaurant);
    const solve = solveScene(scene);
    expect(solve.colliders.filter((c) => c.kind === 'wall').length).toBeGreaterThan(0);
  });
});
