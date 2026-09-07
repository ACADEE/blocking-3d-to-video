import { describe, it, expect } from 'vitest';
import apartment from '../fixtures/apartment.json';
import { normalizeSceneGraph } from '../scene/normalize.js';
import { solveScene } from '../scene/build.js';
import { buildSeedancePrompt } from '../export/seedance.js';
import { buildSeedancePayload, SEEDANCE_MODEL } from './seedance.js';
import { isUsableAssetUrl } from './upload.js';
import { validateClip, validateClipSize, CAPTURE_SIZES, SEEDANCE_VIDEO } from '../export/recorder.js';

const base = { prompt: 'a take', duration: 12 };

describe('payload Seedance', () => {
  it('assemble une requete conforme au modele', () => {
    const p = buildSeedancePayload({
      ...base,
      referenceVideos: ['https://x/a.mp4', 'https://x/b.mp4'],
      resolution: '720p',
      aspectRatio: '16:9',
    });
    expect(p.model).toBe(SEEDANCE_MODEL);
    expect(p.input.prompt).toBe('a take');
    expect(p.input.duration).toBe(12);
    expect(p.input.reference_video_urls).toHaveLength(2);
    expect(p.input.generate_audio).toBe(false);
    expect(p.input.output_format).toBe('mp4');
  });

  it('refuse de melanger image de depart et references multimodales', () => {
    // Les deux scenarios sont exclusifs cote API : on echoue avant l'envoi.
    expect(() =>
      buildSeedancePayload({ ...base, firstFrame: 'https://x/f.png', referenceVideos: ['https://x/a.mp4'] })
    ).toThrow(/exclusi|l'un ou l'autre/i);
  });

  it('refuse une derniere image sans premiere', () => {
    expect(() => buildSeedancePayload({ ...base, lastFrame: 'https://x/l.png' })).toThrow(/sans premiere/i);
  });

  it('refuse un prompt vide ou trop long', () => {
    expect(() => buildSeedancePayload({ ...base, prompt: '  ' })).toThrow(/vide/i);
    expect(() => buildSeedancePayload({ ...base, prompt: 'x'.repeat(30001) })).toThrow(/30000/);
  });

  it('accepte le couple premiere + derniere image', () => {
    const p = buildSeedancePayload({ ...base, firstFrame: 'https://x/f.png', lastFrame: 'https://x/l.png' });
    expect(p.input.first_frame_url).toBe('https://x/f.png');
    expect(p.input.last_frame_url).toBe('https://x/l.png');
    expect(p.input.reference_video_urls).toBeUndefined();
  });

  it('ecarte les URL vides', () => {
    const p = buildSeedancePayload({ ...base, referenceVideos: ['https://x/a.mp4', '', '   '] });
    expect(p.input.reference_video_urls).toEqual(['https://x/a.mp4']);
  });
});

describe('URL exploitables par Seedance', () => {
  it.each([
    ['https://cdn.example.com/a.mp4', true],
    ['asset://asset-20260404242101-76djj', true],
    ['http://localhost:5173/a.mp4', false],
    ['blob:http://localhost:5173/abc', false],
    ['', false],
  ])('%s -> %s', (url, expected) => {
    expect(isUsableAssetUrl(url)).toBe(expected);
  });
});

describe('contraintes video de Seedance', () => {
  it('valide les tailles de capture proposees', () => {
    for (const [key, size] of Object.entries(CAPTURE_SIZES)) {
      expect(validateClipSize(size.width, size.height), `${key} doit passer`).toEqual([]);
      const px = size.width * size.height;
      expect(px).toBeGreaterThanOrEqual(SEEDANCE_VIDEO.minPixels);
      expect(px).toBeLessThanOrEqual(SEEDANCE_VIDEO.maxPixels);
    }
  });

  it('rejette une definition hors de la fenetre de pixels', () => {
    // 1920x1080 depasse largement le maximum tolere par l'API.
    expect(validateClipSize(1920, 1080).join(' ')).toMatch(/hors de la plage/);
    expect(validateClipSize(320, 240).join(' ')).toMatch(/hors de la plage/);
  });

  it('signale duree et poids hors limites', () => {
    const problems = validateClip({ width: 1280, height: 720, duration: 45, size: 300 * 1024 * 1024 });
    expect(problems.join(' ')).toMatch(/duree/);
    expect(problems.join(' ')).toMatch(/200 Mo/);
  });

  it('accepte un clip conforme', () => {
    expect(validateClip({ width: 1280, height: 720, duration: 12, size: 8 * 1024 * 1024 })).toEqual([]);
  });
});

describe('prompt avec passes de blocking jointes', () => {
  const setup = () => {
    const { scene } = normalizeSceneGraph(apartment);
    return { scene, solve: solveScene(scene) };
  };

  it('explique quoi suivre et quoi ne pas reproduire', () => {
    const { scene, solve } = setup();
    const p = buildSeedancePrompt(scene, solve, '', { withReferenceVideos: true, referenceCount: 2 });
    expect(p).toContain('HOW TO USE THE ATTACHED REFERENCE VIDEOS');
    expect(p).toContain('BLOCKING PREVIZ, not a look reference');
    expect(p).toContain('FOLLOW from the references:');
    expect(p).toContain('DO NOT REPRODUCE from the references:');
    // Le point critique : ne pas imiter l'aspect proxy.
    expect(p).toMatch(/grey untextured proxy look/);
    expect(p).toMatch(/Render the scene photorealistically/);
  });

  it("n'ajoute rien quand aucune passe n'est jointe", () => {
    const { scene, solve } = setup();
    const p = buildSeedancePrompt(scene, solve, '');
    expect(p).not.toContain('HOW TO USE THE ATTACHED REFERENCE VIDEOS');
    // Le reste du brief est inchange.
    expect(p).toContain('BEAT BREAKDOWN:');
  });

  it('reste sous la limite de 30000 caracteres', () => {
    const { scene, solve } = setup();
    const p = buildSeedancePrompt(scene, solve, 'x'.repeat(500), { withReferenceVideos: true });
    expect(p.length).toBeLessThan(30000);
  });
});
