/**
 * Tests du masquage AutoMod au rendu : correspondance par mot entier
 * insensible à la casse (accents compris), masque de longueur bornée [3, 8],
 * mots vides ignorés, aucun masquage au milieu d'un autre mot.
 */

import { describe, expect, it } from 'vitest';
import { containsFiltered, maskFiltered } from './automod';

describe('maskFiltered', () => {
  it('rend le texte inchangé sans mot filtré', () => {
    expect(maskFiltered('bonjour tout le monde', [])).toBe('bonjour tout le monde');
    expect(maskFiltered('bonjour', ['zut'])).toBe('bonjour');
  });

  it('ignore les mots vides ou blancs de la liste', () => {
    expect(maskFiltered('bonjour', ['', '   '])).toBe('bonjour');
  });

  it('masque une occurrence avec des █ de même longueur', () => {
    expect(maskFiltered('quel idiot celui-là', ['idiot'])).toBe('quel █████ celui-là');
  });

  it('borne le masque à 3 minimum et 8 maximum', () => {
    expect(maskFiltered('oh zut', ['zut'])).toBe('oh ███');
    expect(maskFiltered('un ah', ['ah'])).toBe('un ███');
    expect(maskFiltered('anticonstitutionnellement !', ['anticonstitutionnellement'])).toBe(
      '████████ !',
    );
  });

  it('est insensible à la casse', () => {
    expect(maskFiltered('IDIOT et Idiot et idiot', ['idiot'])).toBe(
      '█████ et █████ et █████',
    );
  });

  it('gère les accents (casse Unicode)', () => {
    expect(maskFiltered('Espèce de crétin', ['crétin'])).toBe('Espèce de ██████');
    expect(maskFiltered('CRÉTIN va', ['crétin'])).toBe('██████ va');
  });

  it('ne masque pas un mot filtré au milieu d’un autre mot', () => {
    expect(maskFiltered('le chaton dort', ['chat'])).toBe('le chaton dort');
    expect(maskFiltered('achat en ligne', ['chat'])).toBe('achat en ligne');
    // Le mot isolé reste masqué dans la même phrase.
    expect(maskFiltered('le chat et le chaton', ['chat'])).toBe('le ████ et le chaton');
  });

  it('respecte les frontières Unicode (lettre accentuée collée = même mot)', () => {
    expect(maskFiltered('idiotè', ['idiot'])).toBe('idiotè');
  });

  it('masque plusieurs occurrences et plusieurs mots', () => {
    expect(maskFiltered('zut, zut et flûte', ['zut', 'flûte'])).toBe('███, ███ et █████');
  });

  it('masque en bord de ponctuation et de chaîne', () => {
    expect(maskFiltered('idiot', ['idiot'])).toBe('█████');
    expect(maskFiltered('(idiot)', ['idiot'])).toBe('(█████)');
  });

  it('neutralise les métacaractères regex des mots filtrés', () => {
    expect(maskFiltered('a.b partout', ['a.b'])).toBe('███ partout');
    expect(maskFiltered('aXb partout', ['a.b'])).toBe('aXb partout');
  });
});

describe('containsFiltered', () => {
  it('détecte un mot filtré (même règle que maskFiltered)', () => {
    expect(containsFiltered('quel idiot', ['idiot'])).toBe(true);
    expect(containsFiltered('quel IDIOT', ['idiot'])).toBe(true);
    expect(containsFiltered('le chaton', ['chat'])).toBe(false);
    expect(containsFiltered('rien à signaler', ['idiot'])).toBe(false);
    expect(containsFiltered('peu importe', [])).toBe(false);
    expect(containsFiltered('peu importe', ['', ' '])).toBe(false);
  });
});
