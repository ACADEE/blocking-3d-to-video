// Registre des proxys de blocking.
//
// Principe : chaque element de la scene est represente par une primitive
// reconnaissable a la silhouette. Les personnes restent des cylindres (c'est la
// convention de previz), mais une voiture doit se lire comme une voiture, un
// arbre comme un arbre. Ajouter un type = une entree ici + un composant dans
// Proxies.jsx. C'est le point d'extension pour tous les autres elements.

/** Mots-cles FR + EN. Ordre significatif : la premiere correspondance gagne. */
const KEYWORDS = [
  ['truck', /\b(truck|camion|lorry|van|fourgon|utilitaire|semi)\b/i],
  ['car', /\b(car|voiture|auto|automobile|taxi|sedan|berline|coupe|suv|vehicle|vehicule)\b/i],
  ['bike', /\b(bike|bicycle|velo|cycle|scooter|moto|motorcycle)\b/i],
  ['tree', /\b(tree|arbre|platane|oak|chene|palm|palmier)\b/i],
  ['plant', /\b(plant|plante|bush|buisson|shrub|fern|fougere|pot)\b/i],
  ['lamp', /\b(lamp|lampe|lampadaire|streetlight|reverbere|light|luminaire)\b/i],
  ['desk', /\b(desk|bureau|workstation|counter|comptoir|bar)\b/i],
  ['table', /\b(table|dining table|gueridon)\b/i],
  ['chair', /\b(chair|chaise|stool|tabouret|seat|siege)\b/i],
  ['sofa', /\b(sofa|couch|canape|banquette|bench|banc)\b/i],
  ['crate', /\b(crate|caisse|box|carton|palette|pallet|container)\b/i],
  ['door', /\b(door|porte|doorway|gate|portail|doorframe)\b/i],
  [
    'human',
    /\b(human|person|personne|people|man|homme|woman|femme|girl|fille|boy|garcon|child|enfant|guy|lady|waiter|serveur|serveuse|waitress|chef|cook|cuisinier|client|customer|guest|invite|pedestrian|pieton|worker|employe|employee|consultant|executive|manager|director|actor|acteur|protagonist|figurant|extra|crowd|foule|policeman|officer|driver|conducteur|barman)\b/i,
  ],
];

/** Gabarits approches, en metres : largeur (X) x hauteur (Y) x profondeur (Z). */
export const PROXY_BOUNDS = {
  human: { width: 0.5, height: 1.75, depth: 0.5 },
  car: { width: 1.8, height: 1.45, depth: 4.3 },
  truck: { width: 2.4, height: 3.2, depth: 7.2 },
  bike: { width: 0.6, height: 1.1, depth: 1.75 },
  tree: { width: 2.6, height: 5.0, depth: 2.6 },
  plant: { width: 0.7, height: 1.1, depth: 0.7 },
  lamp: { width: 0.4, height: 4.2, depth: 0.4 },
  table: { width: 1.4, height: 0.75, depth: 0.9 },
  desk: { width: 1.8, height: 0.78, depth: 0.8 },
  chair: { width: 0.5, height: 0.95, depth: 0.5 },
  sofa: { width: 2.1, height: 0.85, depth: 0.9 },
  crate: { width: 0.9, height: 0.9, depth: 0.9 },
  door: { width: 1.1, height: 2.1, depth: 0.2 },
  generic: { width: 1.0, height: 1.0, depth: 1.0 },
};

export const PROXY_TYPES = Object.keys(PROXY_BOUNDS);

/**
 * Deduit le type de proxy d'une entite.
 * Un `type` explicite fait foi ; sinon on lit le nom, puis l'action en secours.
 */
export function inferType(entity, fallback = 'generic') {
  if (entity && typeof entity.type === 'string') {
    const t = entity.type.toLowerCase().trim();
    if (PROXY_BOUNDS[t]) return t;
  }
  const haystack = `${entity?.name || ''} ${entity?.action || ''}`;
  for (const [type, re] of KEYWORDS) {
    if (re.test(haystack)) return type;
  }
  return fallback;
}

/** Les acteurs sont humains par defaut : c'est la convention du SceneGraph. */
export function inferActorType(actor) {
  return inferType(actor, 'human');
}

/** Gabarit effectif d'un prop, echelle appliquee. */
export function propBounds(prop) {
  const type = inferType(prop, 'generic');
  const base = PROXY_BOUNDS[type] || PROXY_BOUNDS.generic;
  const s = Number(prop?.scale) || 1;
  return { width: base.width * s, height: base.height * s, depth: base.depth * s, type };
}

/** Libelle court affiche dans l'inspecteur. */
export const TYPE_LABELS = {
  human: 'Personne',
  car: 'Voiture',
  truck: 'Camion',
  bike: 'Deux-roues',
  tree: 'Arbre',
  plant: 'Plante',
  lamp: 'Lampadaire',
  table: 'Table',
  desk: 'Bureau',
  chair: 'Chaise',
  sofa: 'Assise',
  crate: 'Caisse',
  door: 'Porte',
  generic: 'Volume',
};
