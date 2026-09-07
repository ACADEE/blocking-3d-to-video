import React from 'react';

// Indicateur d'attente indeterminee.
//
// Un libelle qui change ne dit pas si le travail avance ou si l'interface est
// figee. Un anneau qui tourne le dit, sans pretendre connaitre une duree qu'on
// ignore : c'est pourquoi il tourne au lieu de se remplir. Les seules barres de
// progression de l'application sont celles dont la duree est reellement connue
// — la capture video.
//
// La couleur suit `currentColor`, pour s'inserer dans un bouton comme dans une
// ligne de statut sans reglage. L'animation respecte `prefers-reduced-motion`,
// gere globalement dans index.css.

export default function Spinner({ className = 'h-3.5 w-3.5', label }) {
  return (
    <svg
      className={`shrink-0 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? 'status' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
