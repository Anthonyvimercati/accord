/**
 * Tests de l'autocomplétion émoji : détection du jeton `:requete` sous le
 * caret (bornes de mot, minimum de longueur, non-déclenchement sur `http://`),
 * classement des suggestions (customs d'abord, préfixe avant sous-chaîne) et
 * insertion (Unicode en caractère, custom en jeton `:name:`).
 */

import { describe, expect, it } from 'vitest';
import {
  findActiveEmojiToken,
  insertEmoji,
  suggestEmojis,
  type CustomEmojiCandidate,
} from './emojiSuggest';

describe('findActiveEmojiToken', () => {
  it('détecte un jeton en début de texte', () => {
    expect(findActiveEmojiToken(':feu', 4)).toEqual({ start: 0, query: 'feu' });
  });

  it('détecte un jeton après un espace', () => {
    expect(findActiveEmojiToken('salut :cha', 10)).toEqual({ start: 6, query: 'cha' });
  });

  it('exige au moins deux caractères de requête', () => {
    expect(findActiveEmojiToken(':f', 2)).toBeNull();
    expect(findActiveEmojiToken(':', 1)).toBeNull();
  });

  it('ne déclenche pas au milieu d’un mot (URL, heure)', () => {
    expect(findActiveEmojiToken('http://exemple', 14)).toBeNull();
    expect(findActiveEmojiToken('rdv 12:30', 9)).toBeNull();
  });

  it('ne déclenche pas juste après un émoji complété', () => {
    expect(findActiveEmojiToken(':feu:', 5)).toBeNull();
  });

  it('s’arrête sur un caractère hors requête', () => {
    expect(findActiveEmojiToken('a :fe u', 7)).toBeNull();
  });
});

describe('suggestEmojis', () => {
  const customs: CustomEmojiCandidate[] = [
    { name: 'fete_perso', merkle_root: 'r1' },
    { name: 'chat_pirate', merkle_root: 'r2' },
  ];

  it('propose un émoji Unicode par mot-clé', () => {
    const s = suggestEmojis('feu', []);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]?.kind).toBe('unicode');
  });

  it('place les customs du contexte avant les Unicode à rang égal', () => {
    const s = suggestEmojis('fete', customs);
    expect(s[0]).toEqual({ kind: 'custom', name: 'fete_perso', merkleRoot: 'r1' });
  });

  it('classe les préfixes avant les sous-chaînes', () => {
    const s = suggestEmojis('chat', customs);
    const noms = s.map((x) => (x.kind === 'custom' ? x.name : x.name));
    expect(noms[0]).toBe('chat_pirate');
  });

  it('borne le nombre de suggestions', () => {
    expect(suggestEmojis('co', [], 3).length).toBeLessThanOrEqual(3);
  });

  it('rend vide sous le minimum de requête', () => {
    expect(suggestEmojis('f', customs)).toEqual([]);
  });
});

describe('insertEmoji', () => {
  it('remplace le jeton par le caractère Unicode suivi d’un espace', () => {
    const out = insertEmoji(
      'salut :feu',
      { start: 6, query: 'feu' },
      {
        kind: 'unicode',
        char: '🔥',
        name: 'feu',
      },
    );
    expect(out.text).toBe('salut 🔥 ');
    expect(out.caret).toBe(out.text.length);
  });

  it('remplace le jeton par un jeton custom complet', () => {
    const out = insertEmoji(
      'go :par des idées',
      { start: 3, query: 'par' },
      {
        kind: 'custom',
        name: 'parrot',
        merkleRoot: 'r',
      },
    );
    expect(out.text).toBe('go :parrot:  des idées');
    expect(out.caret).toBe(3 + ':parrot: '.length);
  });
});
