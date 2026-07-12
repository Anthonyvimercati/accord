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

/**
 * Alpha (haut du dégradé) du fond thématique de la carte de profil — bornée
 * basse exprès (12–18 %, voir `profileCardGradient`) : une simple teinte,
 * jamais un aplat, pour que le texte reste lisible (AA) quelle que soit la
 * couleur source (accent clair ou sombre).
 */
const CARD_TINT_ALPHA = 0.16;

/**
 * Fond CSS (`linear-gradient`) de la carte de profil thématisée façon
 * Discord : une teinte subtile de la couleur de bannière/accent du profil en
 * haut, qui s'estompe vers la surface neutre de la carte en bas. `null` sans
 * couleur de profil connue (aucun changement visuel — la carte garde son
 * fond neutre habituel). Composé PAR-DESSUS la couleur de surface existante
 * (ex. `bg-sidebar/90`) plutôt qu'à sa place : le second point du dégradé est
 * totalement transparent, pas une couleur de repli.
 */
export function profileCardGradient(color: number | null | undefined): string | null {
  if (color === null || color === undefined || !Number.isFinite(color)) return null;
  const c = color & 0xffffff;
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, ${CARD_TINT_ALPHA}) 0%, rgba(${r}, ${g}, ${b}, 0) 100%)`;
}

/**
 * Teinte stable (0-359) dérivée d'une chaîne — badge coloré d'un son de
 * soundboard, pastille d'initiale… Même entrée, même teinte, sur toutes les
 * plateformes (hachage 32 bits façon Java, déterministe et sans dépendance).
 */
export function hueFromString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/**
 * Couleur CSS du badge d'un son de soundboard : teinte stable dérivée du nom,
 * saturation/luminosité fixes choisies pour porter une initiale blanche
 * lisible sur les deux thèmes (clair et sombre).
 */
export function soundBadgeColor(name: string): string {
  return `hsl(${hueFromString(name)} 58% 46%)`;
}
