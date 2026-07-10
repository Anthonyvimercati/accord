/**
 * Tests des bornes de pièces jointes : validation pure des ajouts (10 pièces
 * au plus, 8 Mio chacune), détection d'image et encodage base64.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_PIECES,
  MAX_TAILLE_PIECE,
  estImage,
  fichierEnB64,
  validerAjout,
} from './attachments';

function fichier(name: string, size: number): { name: string; size: number } {
  return { name, size };
}

describe('validerAjout', () => {
  it('accepte des fichiers dans les bornes', () => {
    const bilan = validerAjout(0, [fichier('a.png', 100), fichier('b.pdf', 2048)]);

    expect(bilan.acceptes.map((f) => f.name)).toEqual(['a.png', 'b.pdf']);
    expect(bilan.refusesTaille).toEqual([]);
    expect(bilan.refusesNombre).toBe(0);
  });

  it('refuse un fichier au-delà de 8 Mio en nommant le fautif', () => {
    const bilan = validerAjout(0, [
      fichier('ok.png', MAX_TAILLE_PIECE),
      fichier('gros.bin', MAX_TAILLE_PIECE + 1),
    ]);

    expect(bilan.acceptes.map((f) => f.name)).toEqual(['ok.png']);
    expect(bilan.refusesTaille).toEqual(['gros.bin']);
  });

  it('tronque à 10 pièces par message, en comptant l’existant', () => {
    const fichiers = Array.from({ length: 5 }, (_, i) => fichier(`f${i}.txt`, 10));
    const bilan = validerAjout(MAX_PIECES - 2, fichiers);

    expect(bilan.acceptes).toHaveLength(2);
    expect(bilan.refusesNombre).toBe(3);
  });

  it('ne compte pas les fichiers trop volumineux dans la limite de nombre', () => {
    const bilan = validerAjout(MAX_PIECES - 1, [
      fichier('gros.bin', MAX_TAILLE_PIECE + 1),
      fichier('ok.txt', 10),
    ]);

    expect(bilan.acceptes.map((f) => f.name)).toEqual(['ok.txt']);
    expect(bilan.refusesTaille).toEqual(['gros.bin']);
    expect(bilan.refusesNombre).toBe(0);
  });

  it('n’accepte plus rien quand la limite est atteinte', () => {
    const bilan = validerAjout(MAX_PIECES, [fichier('a.txt', 10)]);

    expect(bilan.acceptes).toEqual([]);
    expect(bilan.refusesNombre).toBe(1);
  });
});

describe('estImage', () => {
  it('reconnaît les types MIME image/*', () => {
    expect(estImage('image/png')).toBe(true);
    expect(estImage('image/webp')).toBe(true);
    expect(estImage('application/pdf')).toBe(false);
    expect(estImage('')).toBe(false);
  });
});

describe('fichierEnB64', () => {
  it('encode les octets en base64 standard sans préfixe data:', async () => {
    const blob = new Blob(['ABC'], { type: 'text/plain' });

    await expect(fichierEnB64(blob)).resolves.toBe('QUJD');
  });
});
