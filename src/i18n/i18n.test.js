import { describe, it, expect } from 'vitest';
import en from './en.js';
import fr from './fr.js';
import { translate } from './index.js';

describe('dictionnaires', () => {
  it('couvrent exactement les memes cles', () => {
    // Une cle presente d'un seul cote se rendrait dans la mauvaise langue.
    const missingInFr = Object.keys(en).filter((k) => !(k in fr));
    const extraInFr = Object.keys(fr).filter((k) => !(k in en));
    expect(missingInFr, `absentes du francais : ${missingInFr.join(', ')}`).toEqual([]);
    expect(extraInFr, `absentes de l'anglais : ${extraInFr.join(', ')}`).toEqual([]);
  });

  it("n'a aucune chaine vide", () => {
    for (const [dict, name] of [[en, 'en'], [fr, 'fr']]) {
      const empty = Object.entries(dict).filter(([, v]) => !String(v).trim());
      expect(empty.map(([k]) => k), `${name} : cles vides`).toEqual([]);
    }
  });

  it('utilise les memes variables dans les deux langues', () => {
    const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en)) {
      expect(vars(fr[key]), `variables divergentes pour "${key}"`).toEqual(vars(en[key]));
    }
  });
});

describe('resolution', () => {
  it('interpole les variables', () => {
    expect(translate('en', 'pipeline.step', { n: 2, total: 3, label: 'Prompt' })).toBe(
      'Step 2 of 3: Prompt'
    );
  });

  it("retombe sur l'anglais quand une cle manque a la traduction", () => {
    expect(translate('fr', 'app.name')).toBe(en['app.name']);
  });

  it('rend la cle elle-meme plutot que du vide si elle est inconnue', () => {
    expect(translate('en', 'cle.inexistante')).toBe('cle.inexistante');
  });
});
