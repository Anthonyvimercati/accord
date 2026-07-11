/**
 * Couleurs de profil : conversion sûre d'un entier `0xRRGGBB` (accent,
 * bannière) en couleur CSS. Même idiome que `roleColorCss` (stores/groups.ts)
 * pour les couleurs de rôle, dupliqué ici plutôt que partagé : deux domaines
 * distincts (profil vs rôles de serveur) avec des règles d'absence différentes
 * (profil : `null`/`undefined` = pas de couleur ; rôle : toujours un entier).
 */

/**
 * Couleur CSS (`#rrggbb`) d'un entier RGB de profil optionnel. `null`,
 * `undefined` ou toute valeur non finie (donnée pair non fiable) rendent
 * `null` (aucune couleur) ; toute autre valeur numérique est ramenée aux 24
 * bits utiles par un simple ET binaire — jamais d'exception, jamais de
 * gabarit hors `#rrggbb` produit, quelle que soit l'entrée.
 */
export function profileColorCss(color: number | null | undefined): string | null {
  if (color === null || color === undefined || !Number.isFinite(color)) return null;
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}
