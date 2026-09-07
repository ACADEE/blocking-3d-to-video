import { useStore } from '../store/useStore.js';
import en from './en.js';
import fr from './fr.js';

// Internationalisation.
//
// Pas de dependance : un dictionnaire plat et une fonction de resolution
// suffisent, et evitent d'embarquer un runtime entier pour deux langues.
//
// Ce qui NE passe jamais par ici : les prompts envoyes au modele et le panneau
// SYSTEM ALERT. Ils s'adressent a une machine ou relevent d'un registre de
// production assume, pas de la langue de l'interface.

const DICTS = { en, fr };
export const LANGUAGES = [
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'fr', label: 'FR', name: 'Francais' },
];

const missing = new Set();

/**
 * Resout une cle, avec interpolation `{nom}`.
 * L'anglais sert de secours : une cle absente de la traduction reste lisible.
 */
export function translate(lang, key, vars) {
  const dict = DICTS[lang] || en;
  let value = dict[key];

  if (value === undefined) {
    value = en[key];
    // Signale une seule fois par cle, en developpement : une chaine manquante
    // doit se voir a la console, pas se rendre en vide a l'ecran.
    if (import.meta.env?.DEV && !missing.has(`${lang}:${key}`)) {
      missing.add(`${lang}:${key}`);
      console.warn(`[i18n] cle absente en "${lang}" : ${key}`);
    }
  }
  if (value === undefined) return key;

  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/** Hook de traduction. Re-rend au changement de langue. */
export function useT() {
  const lang = useStore((s) => s.lang);
  const t = (key, vars) => translate(lang, key, vars);
  t.lang = lang;
  return t;
}

/** Traduction hors composant (messages du store). */
export const t = (key, vars) => translate(useStore.getState().lang, key, vars);

export { en, fr };
