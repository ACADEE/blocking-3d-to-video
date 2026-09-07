// Geometrie partagee.
//
// Ces fonctions vivaient dans normalize.js, que graph.js et collision.js
// importaient. Or la normalisation doit desormais consulter le graphe de zones
// pour aimanter les portes sur leurs ouvertures : le cycle d'imports devenait
// reel. On isole donc ce que tout le monde partage.

/** Empreinte au sol d'une zone. */
export function zoneFootprint(zone) {
  const [x, , z] = zone.position;
  return {
    minX: x - zone.width / 2,
    maxX: x + zone.width / 2,
    minZ: z - zone.depth / 2,
    maxZ: z + zone.depth / 2,
  };
}

/** AABB volumique d'une zone (y part du sol de la zone). */
export function zoneBox(zone) {
  const f = zoneFootprint(zone);
  const y = zone.position[1];
  return { min: [f.minX, y, f.minZ], max: [f.maxX, y + zone.height, f.maxZ] };
}

/**
 * AABB englobant une boite orientee autour de Y.
 *
 * Les volumes de collision sont alignes sur les axes ; la rotation des props
 * etait donc purement ignoree, et un camion tourne a 90 degres presentait une
 * empreinte croisee. On projette l'extension reelle sur X et Z.
 *
 * @param {[number,number,number]} center centre monde
 * @param {[number,number,number]} size dimensions locales (largeur, hauteur, profondeur)
 * @param {number} rotY rotation autour de Y, en radians
 */
export function orientedBounds(center, size, rotY = 0) {
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  const halfX = (size[0] * c + size[2] * s) / 2;
  const halfZ = (size[0] * s + size[2] * c) / 2;
  const halfY = size[1] / 2;
  return {
    min: [center[0] - halfX, center[1] - halfY, center[2] - halfZ],
    max: [center[0] + halfX, center[1] + halfY, center[2] + halfZ],
  };
}

/** Applique une rotation autour de Y a un decalage local. */
export function rotateOffset(offset, rotY = 0) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return [offset[0] * c + offset[2] * s, offset[1], -offset[0] * s + offset[2] * c];
}
