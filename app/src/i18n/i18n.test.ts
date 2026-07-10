/** Tests i18n : interpolation, détection de langue, parité des clés fr/en. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLang, dictionaries, interpolate } from './index';
import { fr } from './fr';
import { en } from './en';

describe('interpolate', () => {
  it('remplace les variables {nom} par leur valeur', () => {
    expect(interpolate('Écrire à @{name}', { name: 'Alice' })).toBe('Écrire à @Alice');
  });

  it('remplace plusieurs occurrences et variables', () => {
    expect(interpolate('{a} et {b} et {a}', { a: '1', b: '2' })).toBe('1 et 2 et 1');
  });

  it('laisse le marqueur visible quand la variable manque', () => {
    expect(interpolate('Bonjour {name}', {})).toBe('Bonjour {name}');
  });

  it('rend le libellé inchangé sans marqueur', () => {
    expect(interpolate('Bonjour', { name: 'x' })).toBe('Bonjour');
  });
});

describe('detectLang', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubNavigator(languages: string[], language: string): void {
    vi.stubGlobal('navigator', { languages, language });
  }

  it('choisit le français pour un système en fr-*', () => {
    stubNavigator(['fr-FR', 'en-US'], 'fr-FR');
    expect(detectLang()).toBe('fr');
  });

  it('replie sur l’anglais pour toute autre langue', () => {
    stubNavigator(['de-DE'], 'de-DE');
    expect(detectLang()).toBe('en');
  });

  it('replie sur `language` quand `languages` est vide', () => {
    stubNavigator([], 'fr-CA');
    expect(detectLang()).toBe('fr');
  });
});

/** Chemins feuilles (`section.cle`) d'un dictionnaire, récursivement. */
function keyPaths(node: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [`${prefix}${key}`]
      : keyPaths(value as Record<string, unknown>, `${prefix}${key}.`),
  );
}

describe('parité des dictionnaires', () => {
  const frPaths = keyPaths(fr).sort();
  const enPaths = keyPaths(en).sort();

  it('expose les deux langues déclarées', () => {
    expect(Object.keys(dictionaries).sort()).toEqual(['en', 'fr']);
  });

  it('en.ts couvre exactement les clés de fr.ts (référence)', () => {
    // Échoue en nommant les clés manquantes ou en trop.
    expect(enPaths).toEqual(frPaths);
  });

  it('aucune traduction n’est vide', () => {
    for (const dict of [fr, en]) {
      for (const path of keyPaths(dict)) {
        const leaf = path
          .split('.')
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], dict);
        expect(leaf, `clé vide : ${path}`).not.toBe('');
      }
    }
  });
});
