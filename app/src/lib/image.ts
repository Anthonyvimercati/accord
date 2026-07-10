/**
 * Préparation d'images de profil côté client : recadrage carré centré simple
 * (`cadrerCarre`, conservé) et recadrage interactif paramétré (zoom + pan)
 * façon Discord. La géométrie du recadreur est purement fonctionnelle et
 * testée ; elle gère un cadre carré (avatar, icône de serveur) comme
 * rectangulaire (bannière paysage). Seul `encoderRecadrage` touche au canvas
 * (encodage PNG/JPEG en base64 prêt pour `profile.set_avatar` /
 * `profile.set_banner` / `groups.set_icon`).
 */

/** Côté maximal de l'avatar envoyé (px). */
export const AVATAR_COTE_PX = 256;

/** Côté par défaut du canvas de sortie du recadreur (px). */
export const TAILLE_SORTIE_PX = 256;

/** Facteur de zoom maximal au-dessus de l'échelle de couverture. */
export const ZOOM_MAX = 3;

/** Taille maximale de l'image décodée acceptée par le nœud (512 Kio). */
export const AVATAR_OCTETS_MAX = 512 * 1024;

/** Qualités JPEG tentées en repli si la sortie PNG dépasse la limite. */
const QUALITES_JPEG = [0.85, 0.7, 0.55] as const;

/** Point 2D en pixels du cadre d'affichage. */
export interface Point {
  x: number;
  y: number;
}

/** Rectangle prélevé dans l'image source (pour `ctx.drawImage`). */
export interface RectSource {
  /** Abscisse du coin haut-gauche dans la source. */
  sx: number;
  /** Ordonnée du coin haut-gauche dans la source. */
  sy: number;
  /** Largeur du rectangle prélevé (px source). */
  largeur: number;
  /** Hauteur du rectangle prélevé (px source). */
  hauteur: number;
}

/** Géométrie d'un recadrage carré centré (pixels source → côté cible). */
export interface CadrageCarre {
  /** Abscisse du coin haut-gauche du carré prélevé dans la source. */
  sx: number;
  /** Ordonnée du coin haut-gauche du carré prélevé dans la source. */
  sy: number;
  /** Côté du carré prélevé (le plus petit des deux côtés source). */
  cote: number;
  /** Côté du carré produit (≤ `maxCote`, jamais agrandi). */
  cible: number;
}

/** Calcule le recadrage carré centré d'une image `largeur` × `hauteur`. */
export function cadrerCarre(
  largeur: number,
  hauteur: number,
  maxCote = AVATAR_COTE_PX,
): CadrageCarre {
  const cote = Math.max(1, Math.min(largeur, hauteur));
  const sx = Math.max(0, Math.floor((largeur - cote) / 2));
  const sy = Math.max(0, Math.floor((hauteur - cote) / 2));
  const cible = Math.min(maxCote, cote);
  return { sx, sy, cote, cible };
}

/**
 * Échelle minimale (px cadre par px source) pour qu'une image
 * `largeur` × `hauteur` couvre entièrement un cadre `cadreW` × `cadreH` px.
 * Pour un cadre carré (`cadreW === cadreH`), équivaut à
 * `cadre / min(largeur, hauteur)` — comportement historique de l'avatar.
 */
export function echelleCouverture(
  largeur: number,
  hauteur: number,
  cadreW: number,
  cadreH: number,
): number {
  const l = Math.max(1, largeur);
  const h = Math.max(1, hauteur);
  return Math.max(cadreW / l, cadreH / h);
}

/** Borne un axe pour que l'image mise à l'échelle couvre toujours le cadre. */
function bornerAxe(valeur: number, cadre: number, taille: number): number {
  // Image plus étroite que le cadre : on la centre (cas dégénéré).
  if (taille <= cadre) return (cadre - taille) / 2;
  const min = cadre - taille; // ≤ 0 : bord droit/bas aligné sur le cadre.
  return Math.max(min, Math.min(0, valeur));
}

/**
 * Contraint un décalage (coin haut-gauche de l'image mise à l'échelle, en px
 * cadre) pour que l'image recouvre toujours le cadre — aucun vide. Chaque axe
 * est borné indépendamment (cadre potentiellement rectangulaire).
 */
export function contraindreDecalage(
  decalage: Point,
  largeur: number,
  hauteur: number,
  cadreW: number,
  cadreH: number,
  echelle: number,
): Point {
  const largeurMiseAEchelle = largeur * echelle;
  const hauteurMiseAEchelle = hauteur * echelle;
  return {
    x: bornerAxe(decalage.x, cadreW, largeurMiseAEchelle),
    y: bornerAxe(decalage.y, cadreH, hauteurMiseAEchelle),
  };
}

/**
 * Mappe le cadre visible vers le rectangle source à prélever : un point cadre
 * `p` correspond à la source `(p - décalage) / échelle`. Le rectangle produit a
 * les proportions du cadre (carré pour l'avatar, paysage pour la bannière).
 */
export function rectangleSource(
  decalage: Point,
  cadreW: number,
  cadreH: number,
  echelle: number,
): RectSource {
  return {
    sx: -decalage.x / echelle,
    sy: -decalage.y / echelle,
    largeur: cadreW / echelle,
    hauteur: cadreH / echelle,
  };
}

/** Nombre d'octets décodés d'une chaîne base64 (sans préfixe `data:`). */
export function octetsBase64(b64: string): number {
  const remplissage = /=+$/.exec(b64)?.[0].length ?? 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - remplissage);
}

/** Charge une image depuis une URL (blob ou data). */
export function chargerImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image illisible'));
    img.src = url;
  });
}

/** Image encodée, prête pour l'envoi au nœud et l'aperçu local. */
export interface AvatarEncode {
  dataB64: string;
  mime: string;
  dataUrl: string;
}

/** Paramètres de la région visible du recadreur à exporter. */
export interface RecadrageParams {
  /** Largeur naturelle de l'image source (px). */
  largeur: number;
  /** Hauteur naturelle de l'image source (px). */
  hauteur: number;
  /** Largeur du cadre d'affichage (px). */
  cadreW: number;
  /** Hauteur du cadre d'affichage (px). */
  cadreH: number;
  /** Échelle courante (px cadre par px source). */
  echelle: number;
  /** Décalage courant du coin haut-gauche de l'image (px cadre). */
  decalage: Point;
  /** Largeur du canvas de sortie (px, défaut `TAILLE_SORTIE_PX`). */
  tailleW?: number | undefined;
  /** Hauteur du canvas de sortie (px, défaut `TAILLE_SORTIE_PX`). */
  tailleH?: number | undefined;
}

/** Octets décodés portés par une data URL. */
function octetsDataUrl(dataUrl: string): number {
  return octetsBase64(dataUrl.slice(dataUrl.indexOf(',') + 1));
}

/** Dessine la région source (`largeurSrc` × `hauteurSrc`) sur un canvas de sortie. */
function dessinerCanvas(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  largeurSrc: number,
  hauteurSrc: number,
  sortieW: number,
  sortieH: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = sortieW;
  canvas.height = sortieH;
  const contexte = canvas.getContext('2d');
  if (contexte === null) throw new Error('canvas indisponible');
  contexte.drawImage(source, sx, sy, largeurSrc, hauteurSrc, 0, 0, sortieW, sortieH);
  return canvas;
}

/** Encode un canvas en PNG, avec repli JPEG si la limite d'octets est franchie. */
function encoderCanvas(canvas: HTMLCanvasElement): AvatarEncode {
  let dataUrl = canvas.toDataURL('image/png');
  let mime = 'image/png';
  if (octetsDataUrl(dataUrl) > AVATAR_OCTETS_MAX) {
    for (const qualite of QUALITES_JPEG) {
      dataUrl = canvas.toDataURL('image/jpeg', qualite);
      mime = 'image/jpeg';
      if (octetsDataUrl(dataUrl) <= AVATAR_OCTETS_MAX) break;
    }
  }
  return { dataB64: dataUrl.slice(dataUrl.indexOf(',') + 1), mime, dataUrl };
}

/** Plancher de réduction de la sortie (px) avant abandon de la boucle. */
const SORTIE_PLANCHER_PX = 64;

/**
 * Recadre la région visible du recadreur sur un canvas aux proportions du cadre
 * (carré pour l'avatar, paysage pour la bannière) et l'encode en base64. La
 * sortie n'est jamais agrandie au-delà de la région source ; si elle dépasse
 * `AVATAR_OCTETS_MAX`, on réduit les deux dimensions jusqu'à repasser sous la
 * limite.
 */
export function encoderRecadrage(
  source: CanvasImageSource,
  params: RecadrageParams,
): AvatarEncode {
  const { largeur, hauteur, cadreW, cadreH, echelle, decalage } = params;
  const tailleW = params.tailleW ?? TAILLE_SORTIE_PX;
  const tailleH = params.tailleH ?? TAILLE_SORTIE_PX;
  const rect = rectangleSource(decalage, cadreW, cadreH, echelle);
  const largeurSrc = Math.min(Math.max(1, rect.largeur), Math.max(1, largeur));
  const hauteurSrc = Math.min(Math.max(1, rect.hauteur), Math.max(1, hauteur));
  const sx = Math.min(Math.max(0, rect.sx), Math.max(0, largeur - largeurSrc));
  const sy = Math.min(Math.max(0, rect.sy), Math.max(0, hauteur - hauteurSrc));

  // Facteur uniforme ≤ 1 : préserve le ratio du cadre sans jamais agrandir.
  const facteur = Math.min(1, largeurSrc / tailleW, hauteurSrc / tailleH);
  let sortieW = Math.max(1, Math.round(tailleW * facteur));
  let sortieH = Math.max(1, Math.round(tailleH * facteur));
  let resultat = encoderCanvas(
    dessinerCanvas(source, sx, sy, largeurSrc, hauteurSrc, sortieW, sortieH),
  );
  while (
    octetsBase64(resultat.dataB64) > AVATAR_OCTETS_MAX &&
    Math.min(sortieW, sortieH) > SORTIE_PLANCHER_PX
  ) {
    sortieW = Math.max(SORTIE_PLANCHER_PX, Math.round(sortieW * 0.8));
    sortieH = Math.max(SORTIE_PLANCHER_PX, Math.round(sortieH * 0.8));
    resultat = encoderCanvas(
      dessinerCanvas(source, sx, sy, largeurSrc, hauteurSrc, sortieW, sortieH),
    );
  }
  return resultat;
}
