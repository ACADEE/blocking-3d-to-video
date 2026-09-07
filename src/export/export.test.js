import { describe, it, expect } from 'vitest';
import apartment from '../fixtures/apartment.json';
import street from '../fixtures/street.json';
import { normalizeSceneGraph } from '../scene/normalize.js';
import { solveScene } from '../scene/build.js';
import { buildBlenderScript } from './blender.js';
import { buildSeedancePrompt } from './seedance.js';

const setup = (fixture) => {
  const { scene } = normalizeSceneGraph(fixture);
  return { scene, solve: solveScene(scene) };
};

describe('export Blender', () => {
  it('produit un script complet et coherent avec la scene', () => {
    const { scene, solve } = setup(apartment);
    const py = buildBlenderScript(scene, solve);

    expect(py).toContain('import bpy');
    expect(py).toContain('BLOCKING_3D');
    expect(py).toContain('scene.camera = cam');
    expect(py).toContain(`FPS = ${scene.project.fps}`);
    expect(py).toContain(`FRAME_COUNT = ${solve.track.frames.length}`);
    expect(py).toContain(`CAM_LENS = ${scene.camera.lens}`);
    // Sensor vertical : c'est ce qui fait correspondre le champ a celui du navigateur.
    expect(py).toContain("sensor_fit = 'VERTICAL'");
  });

  it('bake une cle par image pour la camera et pour chaque acteur', () => {
    const { scene, solve } = setup(apartment);
    const py = buildBlenderScript(scene, solve);
    const frames = solve.track.frames.length;

    const camKeys = JSON.parse(py.match(/CAM_KEYS = (\[.*?\])\nTARGET_KEYS/s)[1]);
    const actors = JSON.parse(py.match(/ACTORS = (\[.*?\])\nCAM_KEYS/s)[1]);

    expect(camKeys).toHaveLength(frames);
    expect(actors).toHaveLength(scene.actors.length);
    for (const a of actors) expect(a.keys).toHaveLength(frames);
  });

  it('convertit le repere three.js (Y-up) vers Blender (Z-up)', () => {
    const { scene, solve } = setup(apartment);
    const py = buildBlenderScript(scene, solve);
    const camKeys = JSON.parse(py.match(/CAM_KEYS = (\[.*?\])\nTARGET_KEYS/s)[1]);

    const first = solve.track.frames[0].position;
    const [X, Y, Z] = camKeys[0];
    expect(X).toBeCloseTo(first.x, 3);
    expect(Y).toBeCloseTo(-first.z, 3);
    expect(Z).toBeCloseTo(first.y, 3);
    // La hauteur Blender doit correspondre a la hauteur de rig, pas a une profondeur.
    expect(Z).toBeCloseTo(scene.camera.height, 1);
  });

  it("n'insere pas de guillemet non echappe depuis le nom de projet", () => {
    const raw = { ...apartment, project: { ...apartment.project, name: "L'appart \"test\"" } };
    const { scene, solve } = setup(raw);
    const py = buildBlenderScript(scene, solve);
    const printLine = py.split('\n').find((l) => l.includes('BLOCKING.3D: imported'));
    expect(printLine).toContain("L\\'appart");
  });
});

describe('export prompt Seedance', () => {
  it('reprend les parametres reels de la prise', () => {
    const { scene, solve } = setup(apartment);
    const prompt = buildSeedancePrompt(scene, solve, 'a woman walks into the kitchen');

    expect(prompt).toContain('DURATION:');
    expect(prompt).toContain(`${scene.project.duration} seconds`);
    expect(prompt).toContain(`${scene.camera.lens}mm`);
    expect(prompt).toContain('Steadicam');
    expect(prompt).toContain('ONE UNINTERRUPTED TAKE');
    expect(prompt).toContain('a woman walks into the kitchen');
  });

  it('decoupe la prise en beats aux franchissements de porte', () => {
    const { scene, solve } = setup(apartment);
    const prompt = buildSeedancePrompt(scene, solve);

    expect(prompt).toContain('BEAT BREAKDOWN:');
    expect(prompt).toContain('Living Room');
    expect(prompt).toContain('Corridor');
    expect(prompt).toContain('Kitchen');
    // Un beat par piece traversee par le sujet suivi.
    const route = solve.actorPaths.get(scene.camera.target).route;
    const beats = prompt.match(/^\d+\.\d{2}–\d+\.\d{2} SEC$/gm);
    expect(beats.length).toBe(route.zones.length);
  });

  it('interdit explicitement la teleportation des personnages', () => {
    const { scene, solve } = setup(apartment);
    const prompt = buildSeedancePrompt(scene, solve);
    expect(prompt).toContain('never teleport');
    expect(prompt).toMatch(/No characters teleporting/);
  });

  it('adapte la lumiere a un exterieur', () => {
    const { scene, solve } = setup(street);
    const prompt = buildSeedancePrompt(scene, solve);
    expect(prompt).toContain('exterior');
    expect(prompt).toContain('Natural daylight');
    expect(prompt).toContain('Dolly on track');
  });
});
