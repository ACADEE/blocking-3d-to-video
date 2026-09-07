import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import apartment from '../fixtures/apartment.json';
import street from '../fixtures/street.json';
import { normalizeSceneGraph } from './normalize.js';
import { solveScene } from './build.js';
import { resolveCollisions } from './autocorrect.js';
import { clearanceAt, CAMERA_RADIUS } from './collision.js';
import { orientedBounds } from './geometry.js';

/** Scene en L avec une porte posee dans l'ouverture de la cuisine. */
function apartmentWithDoor(mutate = () => {}) {
  const raw = JSON.parse(JSON.stringify(apartment));
  const kd = solveScene(normalizeSceneGraph(raw).scene).graph.doorways.find(
    (d) => d.name === 'Kitchen Doorframe'
  );
  raw.props.push({
    id: 'prop_door',
    name: 'Heavy Glass Entrance Door',
    type: 'door',
    zone: 'zone_2',
    position: [kd.position[0], 0, kd.position[2]],
    rotation: 0,
    color: '#8A8F98',
  });
  mutate(raw, kd);
  const { scene, warnings } = normalizeSceneGraph(raw);
  return { scene, warnings, doorway: kd, solve: solveScene(scene) };
}

describe('une porte est une ouverture, pas un mur', () => {
  it('produit deux montants et un linteau, pas un bloc plein', () => {
    const { solve } = apartmentWithDoor();
    const parts = solve.colliders.filter((c) => c.id.startsWith('prop_door'));
    expect(parts.map((c) => c.id.replace('prop_door_', '')).sort()).toEqual([
      'jamb_a',
      'jamb_b',
      'lintel',
    ]);
    expect(parts.every((c) => c.name === 'Heavy Glass Entrance Door')).toBe(true);
  });

  it('laisse le passage libre en son centre', () => {
    const { solve, doorway } = apartmentWithDoor();
    const centre = new Vector3(doorway.position[0], 1.2, doorway.position[2]);
    const { distance } = clearanceAt(solve.colliders, centre);
    expect(distance, 'le centre de l ouverture doit rester franchissable').toBeGreaterThan(
      CAMERA_RADIUS
    );
  });

  it("ne coute pas plus de contacts qu'une scene sans porte", () => {
    // C'etait le bug : un volume plein de 1,1 m posait un mur infranchissable et
    // faisait passer la scene de 14 a 26 contacts.
    const bare = solveScene(normalizeSceneGraph(apartment).scene);
    const { solve } = apartmentWithDoor();
    expect(solve.collision.hits.length).toBeLessThanOrEqual(bare.collision.hits.length);
  });

  it("ne double pas les montants generes par l'ouverture", () => {
    const { solve } = apartmentWithDoor();
    const generated = solve.colliders.filter(
      (c) => c.id.includes('_jamb_') && c.name === 'Kitchen Doorframe'
    );
    expect(generated, 'le prop porte remplace les montants generes').toHaveLength(0);
  });
});

describe('une porte est aimantee sur son ouverture', () => {
  it("n'est pas rabattue dans l'empreinte d'une zone", () => {
    // Declaree dans le couloir, elle etait clampee a x = 0,6, en plein passage.
    const { scene, doorway } = apartmentWithDoor();
    const door = scene.props.find((p) => p.id === 'prop_door');
    expect(door.position[0]).toBeCloseTo(doorway.position[0], 2);
    expect(door.position[2]).toBeCloseTo(doorway.position[2], 2);
  });

  it("s'oriente selon l'axe de l'ouverture", () => {
    const { scene, doorway } = apartmentWithDoor();
    const door = scene.props.find((p) => p.id === 'prop_door');
    expect(doorway.axis).toBe('x');
    expect(door.rotation).toBeCloseTo(Math.PI / 2, 2);
  });

  it('signale le recalage quand elle a du etre deplacee', () => {
    const { warnings } = apartmentWithDoor((raw) => {
      raw.props.at(-1).position = [0, 0, -10];
    });
    expect(warnings.join(' ')).toMatch(/recalee sur l'ouverture/);
  });

  it("est reconnue par son nom meme sans type declare", () => {
    const { scene, doorway } = apartmentWithDoor((raw) => {
      raw.props.at(-1).type = null;
    });
    const door = scene.props.find((p) => p.id === 'prop_door');
    expect(door.type).toBe('door');
    expect(door.position[0]).toBeCloseTo(doorway.position[0], 2);
  });
});

describe('la rotation des props compte', () => {
  it("croise l'empreinte d'un volume tourne a 90 degres", () => {
    // Un camion de 2,4 x 7,2 tourne d'un quart de tour occupe 7,2 x 2,4.
    const b = orientedBounds([0, 1.6, 0], [2.4, 3.2, 7.2], Math.PI / 2);
    expect(b.max[0] - b.min[0]).toBeCloseTo(7.2, 3);
    expect(b.max[2] - b.min[2]).toBeCloseTo(2.4, 3);
  });

  it('applique cette rotation au camion de la scene de rue', () => {
    const { scene } = normalizeSceneGraph(street);
    const solve = solveScene(scene);
    const truck = solve.colliders.find((c) => c.name === 'Delivery Truck');
    // rotation 1.57 dans la fixture : la longueur doit suivre X, pas Z.
    expect(truck.max[0] - truck.min[0]).toBeGreaterThan(truck.max[2] - truck.min[2]);
  });
});

describe('resolution de collision', () => {
  it("n'applique jamais un resultat moins bon que l'etat courant", () => {
    const { scene, solve } = apartmentWithDoor();
    const r = resolveCollisions({ scene, solve });
    if (r.applied) {
      expect(r.hitsAfter).toBeLessThan(r.hitsBefore);
    } else {
      expect(r.scene).toBeNull();
      expect(r.hitsAfter).toBe(r.hitsBefore);
    }
  });

  it('escalade sur les variantes de rig quand la trajectoire seule ne suffit pas', () => {
    const { scene, solve } = apartmentWithDoor();
    const r = resolveCollisions({ scene, solve });
    expect(r.resolved, `contacts restants : ${r.hitsAfter}`).toBe(true);
    // Une variante de rig a ete retenue : elle doit etre nommee a l'utilisateur.
    if (r.change) expect(r.change).toMatch(/->/);
  });

  it('preserve la trajectoire quand le relachement seul suffit', () => {
    const { scene } = normalizeSceneGraph(apartment);
    const solve = solveScene(scene);
    const r = resolveCollisions({ scene, solve });
    expect(r.resolved).toBe(true);
    expect(r.change, 'aucun reglage de prise ne doit changer inutilement').toBeNull();
    expect(r.scene.project.duration).toBe(scene.project.duration);
  });
});
