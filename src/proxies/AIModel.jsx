import React, { useMemo } from 'react';
import * as THREE from 'three';

// Rendu d'un modele genere par GPT-6 Astra.
//
// Le code arrive sous forme de source three.js. On le compile une fois, dans un
// contexte reduit, puis on rend le groupe obtenu. Si quoi que ce soit echoue on
// renvoie null et l'appelant retombe sur le proxy procedural : un modele rate
// ne doit jamais faire disparaitre un element du blocking.
//
// Le code est produit par un modele a la demande de l'utilisateur, avec sa
// propre cle, et s'execute dans la page. On le compile donc via `new Function`
// avec une liste d'arguments fermee (THREE, color) plutot que par eval global,
// et on refuse au prealable les motifs qui n'ont rien a faire dans de la
// geometrie.

const FORBIDDEN = [
  /\bimport\b/,
  /\brequire\s*\(/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\bglobalThis\b/,
  /\blocalStorage\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bWorker\b/,
  /\bnavigator\b/,
];

/**
 * @param {string} source code renvoye par le modele
 * @returns {{ ok: true, build: Function } | { ok: false, error: string }}
 */
export function compileModel(source) {
  if (typeof source !== 'string' || !source.trim()) {
    return { ok: false, error: 'Modele vide.' };
  }
  const offending = FORBIDDEN.find((re) => re.test(source));
  if (offending) {
    return { ok: false, error: `Code refuse : motif interdit ${offending}.` };
  }

  try {
    // Le corps declare `build` puis on le renvoie : cela accepte aussi bien une
    // declaration de fonction qu'une expression assignee.
    const factory = new Function(
      'THREE',
      `"use strict";\n${source}\nreturn typeof build === 'function' ? build : null;`
    );
    const build = factory(THREE);
    if (typeof build !== 'function') {
      return { ok: false, error: "Le code ne definit pas de fonction build()." };
    }
    return { ok: true, build };
  } catch (err) {
    return { ok: false, error: `Compilation impossible : ${err.message}` };
  }
}

/**
 * Compile puis execute, et verifie que le resultat tient dans le gabarit prevu.
 * Un modele hors gabarit est remis a l'echelle plutot que rejete : la silhouette
 * reste juste, et le cadrage comme la collision restent valides.
 */
export function instantiateModel(source, color, bounds) {
  const compiled = compileModel(source);
  if (!compiled.ok) return compiled;

  let group;
  try {
    group = compiled.build(THREE, new THREE.Color(color));
  } catch (err) {
    return { ok: false, error: `Execution impossible : ${err.message}` };
  }
  if (!group || !group.isObject3D) {
    return { ok: false, error: 'build() n\'a pas renvoye un objet three.js.' };
  }

  if (bounds) {
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return { ok: false, error: 'Le modele est vide.' };
    const size = box.getSize(new THREE.Vector3());
    const target = new THREE.Vector3(bounds.width, bounds.height, bounds.depth);
    const factor = Math.min(
      ...['x', 'y', 'z'].map((a) => (size[a] > 1e-4 ? target[a] / size[a] : Infinity))
    );
    if (Number.isFinite(factor) && (factor < 0.95 || factor > 1.05)) {
      group.scale.multiplyScalar(factor);
    }
    // On repose le modele au sol : le modele oublie parfois la contrainte y >= 0.
    const rebased = new THREE.Box3().setFromObject(group);
    group.position.y -= rebased.min.y;
  }

  return { ok: true, group };
}

/** Affiche un modele IA, ou `fallback` si le code est inutilisable. */
export default function AIModel({ source, color, bounds, fallback = null, onError }) {
  const result = useMemo(
    () => instantiateModel(source, color, bounds),
    [source, color, bounds?.width, bounds?.height, bounds?.depth]
  );

  if (!result.ok) {
    if (onError) onError(result.error);
    return fallback;
  }
  return <primitive object={result.group} />;
}
