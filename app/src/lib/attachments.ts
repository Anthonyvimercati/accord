/**
 * Pièces jointes côté saisie : bornes du contrat (10 pièces au plus par
 * message, 8 Mio décodés au plus par pièce — borne `files.share_bytes` et
 * `files.read`), validation pure des ajouts et encodage base64 des octets.
 *
 * La borne des 8 Mio ne gouverne plus QUE les entrées en mémoire (objets
 * `File` du glisser-déposer et du collage), publiées via `files.share_bytes`
 * (8 Mio décodés). Le bouton de pièce jointe passe désormais par le sélecteur
 * natif Tauri (plugin dialog) et `api.filesShare` (chemin disque, jusqu'à
 * 2 Gio) : ce chemin n'est PAS plafonné. `validerAjout` et `MAX_TAILLE_PIECE`
 * ne s'appliquent donc qu'aux `File` en mémoire (aperçu/inline), et le message
 * d'erreur redirige les gros fichiers vers le bouton de pièce jointe.
 */

/** Nombre maximal de pièces jointes par message (contrat dm/groups.send). */
export const MAX_PIECES = 10;

/** Taille maximale d'une pièce en mémoire (8 Mio, borne files.share_bytes/files.read). */
export const MAX_TAILLE_PIECE = 8 * 1024 * 1024;

/** Vrai si le type MIME désigne une image (vignette possible). */
export function estImage(mime: string): boolean {
  return mime.startsWith('image/');
}

/** Vrai si le type MIME désigne un contenu audio (message vocal, lecteur dédié). */
export function estAudio(mime: string): boolean {
  return mime.startsWith('audio/');
}

/** Bilan d'un ajout de fichiers à un message en cours de composition. */
export interface AjoutPieces<T> {
  /** Fichiers admis, dans la limite du nombre et de la taille. */
  acceptes: T[];
  /** Noms refusés pour dépassement de la taille unitaire (8 Mio). */
  refusesTaille: string[];
  /** Nombre de fichiers refusés faute de place (limite de 10). */
  refusesNombre: number;
}

/**
 * Valide l'ajout de `fichiers` à un message qui compte déjà `nbCourant`
 * pièces : écarte les fichiers trop volumineux, puis tronque à la limite.
 */
export function validerAjout<T extends { name: string; size: number }>(
  nbCourant: number,
  fichiers: readonly T[],
): AjoutPieces<T> {
  const acceptes: T[] = [];
  const refusesTaille: string[] = [];
  let refusesNombre = 0;
  for (const fichier of fichiers) {
    if (fichier.size > MAX_TAILLE_PIECE) {
      refusesTaille.push(fichier.name);
      continue;
    }
    if (nbCourant + acceptes.length >= MAX_PIECES) {
      refusesNombre += 1;
      continue;
    }
    acceptes.push(fichier);
  }
  return { acceptes, refusesTaille, refusesNombre };
}

/**
 * Fichier → URL `data:` affichable (aperçus, recadreur). Les URL `blob:`
 * ne sont pas rendues par la WKWebView de l'app packagée (Tauri/macOS).
 */
export function fichierEnDataUrl(fichier: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error('fichier illisible'));
    lecteur.onload = () => resolve(String(lecteur.result));
    lecteur.readAsDataURL(fichier);
  });
}

/** Octets d'un fichier en base64 standard (sans le préfixe `data:`). */
export function fichierEnB64(fichier: Blob): Promise<string> {
  return fichierEnDataUrl(fichier).then((dataUrl) =>
    dataUrl.slice(dataUrl.indexOf(',') + 1),
  );
}
