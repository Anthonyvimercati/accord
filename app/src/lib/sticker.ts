/**
 * Stickers de serveur : mêmes règles de nommage/MIME que les émojis de
 * serveur (contrat `groups.stickers.*`), mais une image plus grande —
 * limite d'envoi 512 Kio (contre 256 Kio pour un émoji) et plafond de 30
 * stickers par serveur (contre 50 émojis).
 */

import { EMOJI_MIMES, EMOJI_NAME_RE } from './emoji';

/** Vrai si `name` respecte les bornes de nom du contrat `groups.stickers.add` (identiques aux émojis). */
export function estNomStickerValide(name: string): boolean {
  return EMOJI_NAME_RE.test(name);
}

/** Taille maximale de l'image d'un sticker, une fois décodée (512 Kio). */
export const STICKER_OCTETS_MAX = 512 * 1024;

/** Nombre maximal de stickers par serveur (contrat `groups.stickers.add`). */
export const STICKER_MAX_PAR_SERVEUR = 30;

/** Types MIME acceptés pour un sticker de serveur (contrat, identiques aux émojis). */
export const STICKER_MIMES = EMOJI_MIMES;

/** Vrai si `mime` est un type d'image accepté pour un sticker. */
export function estMimeStickerValide(mime: string): boolean {
  return (STICKER_MIMES as readonly string[]).includes(mime);
}

/**
 * Plafond de mise à l'échelle d'un sticker à la compression (px) — plus
 * grand qu'un émoji (128 px) : un sticker s'affiche en grand dans le fil
 * (voir `components/StickerImage.tsx`), quand un émoji reste inline au texte.
 */
export const STICKER_TAILLE_MAX_PX = 320;

/** Paliers de dimension tentés à la compression, du plus grand au plus petit. */
export const STICKER_PALIERS_TAILLE = [STICKER_TAILLE_MAX_PX, 240, 160] as const;
