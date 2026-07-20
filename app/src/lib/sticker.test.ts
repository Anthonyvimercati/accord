/** Tests des validateurs de sticker de serveur (nom, MIME, bornes du contrat). */

import { describe, expect, it } from 'vitest';
import {
  estMimeStickerValide,
  estNomStickerValide,
  STICKER_MAX_PAR_SERVEUR,
  STICKER_OCTETS_MAX,
  STICKER_PALIERS_TAILLE,
} from './sticker';

describe('estNomStickerValide', () => {
  it('accepte minuscules, chiffres et « _ » (2 à 32)', () => {
    expect(estNomStickerValide('coucou')).toBe(true);
    expect(estNomStickerValide('sticker_01')).toBe(true);
  });

  it('rejette majuscules, caractères interdits et longueurs hors bornes', () => {
    expect(estNomStickerValide('Coucou')).toBe(false);
    expect(estNomStickerValide('a')).toBe(false);
    expect(estNomStickerValide('avec-tiret')).toBe(false);
    expect(estNomStickerValide('a'.repeat(33))).toBe(false);
  });
});

describe('estMimeStickerValide', () => {
  it('accepte les types image du contrat', () => {
    expect(estMimeStickerValide('image/webp')).toBe(true);
    expect(estMimeStickerValide('image/png')).toBe(true);
  });

  it('rejette les types non-image', () => {
    expect(estMimeStickerValide('application/pdf')).toBe(false);
    expect(estMimeStickerValide('text/plain')).toBe(false);
  });
});

describe('bornes de sticker', () => {
  it('respecte le contrat (512 Kio, 30 par serveur, paliers décroissants)', () => {
    expect(STICKER_OCTETS_MAX).toBe(512 * 1024);
    expect(STICKER_MAX_PAR_SERVEUR).toBe(30);
    expect([...STICKER_PALIERS_TAILLE]).toEqual(
      [...STICKER_PALIERS_TAILLE].sort((a, b) => b - a),
    );
  });
});
