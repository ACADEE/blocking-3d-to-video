import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './useStore.js';
import apartment from '../fixtures/apartment.json';

// Ces trois actions sont le pendant, pour la camera, de ce que PathHandles
// fait deja pour un acteur : deplacer une cle existante et en inserer une par
// clic sur le ruban. Le geste 3D (glisser un TransformControls) n'est pas
// simulable ici ; ce qui l'est, et qui a deja perdu des actions du store par
// le passe sans que les tests s'en apercoivent, c'est la logique qu'il
// declenche.

const loadScene = (mutate = () => {}) => {
  const raw = JSON.parse(JSON.stringify(apartment));
  mutate(raw);
  useStore.getState().importScene(raw);
};

describe('cles camera : deplacer, inserer, supprimer', () => {
  beforeEach(() => {
    loadScene((r) => {
      r.camera.keys = [
        { t: 0, position: [0, 1.6, 4] },
        { t: 12, position: [0, 1.6, -12] },
      ];
    });
  });

  it("deplace une cle existante sans changer son instant ni les autres cles", () => {
    const before = useStore.getState().scene.camera.keys;
    useStore.getState().moveCameraKey(0, [2, 1.8, 4]);
    const after = useStore.getState().scene.camera.keys;
    expect(after[0].t).toBe(before[0].t);
    expect(after[0].position).toEqual([2, 1.8, 4]);
    expect(after[1]).toEqual(before[1]);
  });

  it("efface l'apercu de glisse au moment du commit", () => {
    useStore.getState().setCameraDragPreview({ position: [9, 9, 9], curve: [[9, 9, 9]] });
    expect(useStore.getState().cameraDragPreview).not.toBeNull();
    useStore.getState().moveCameraKey(0, [2, 1.8, 4]);
    expect(useStore.getState().cameraDragPreview).toBeNull();
  });

  it('insere une cle a mi-chemin de deux cles voisines, triee par instant', () => {
    useStore.getState().insertCameraKeyAfter(0, [1, 1.6, -4]);
    const keys = useStore.getState().scene.camera.keys;
    expect(keys).toHaveLength(3);
    expect(keys[1].t).toBeCloseTo(6, 3);
    expect(keys[1].position).toEqual([1, 1.6, -4]);
    expect(keys.every((k, i) => i === 0 || k.t > keys[i - 1].t)).toBe(true);
  });

  it("n'insere rien apres la derniere cle : il n'y a pas de voisine suivante", () => {
    useStore.getState().insertCameraKeyAfter(12, [0, 0, 0]);
    expect(useStore.getState().scene.camera.keys).toHaveLength(2);
  });

  it('ignore un instant qui ne correspond a aucune cle', () => {
    const before = useStore.getState().scene.camera.keys;
    useStore.getState().moveCameraKey(999, [9, 9, 9]);
    useStore.getState().insertCameraKeyAfter(999, [9, 9, 9]);
    expect(useStore.getState().scene.camera.keys).toEqual(before);
  });

  it('repasse a un trajet calcule quand la suppression laisse moins de deux cles', () => {
    useStore.getState().removeCameraKey(0);
    expect(useStore.getState().scene.camera.keys).toBeNull();
  });
});
