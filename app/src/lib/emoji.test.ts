/**
 * Tests des aides d'émojis : validation de nom et de type MIME, jetons texte
 * et valeurs de réaction (`:name:` vs `":name:"`), et conversion d'un choix.
 */

import { describe, expect, it } from 'vitest';
import {
  estMimeEmojiValide,
  estNomEmojiValide,
  jetonEmojiTexte,
  jetonTexteEmoji,
  nomReactionEmoji,
  valeurReaction,
  valeurReactionEmoji,
} from './emoji';

describe('validation', () => {
  it('accepte un nom [a-z0-9_] de 2 à 32 caractères', () => {
    expect(estNomEmojiValide('parrot')).toBe(true);
    expect(estNomEmojiValide('a_1')).toBe(true);
  });

  it('rejette majuscules, caractères spéciaux et bornes de longueur', () => {
    expect(estNomEmojiValide('Parrot')).toBe(false);
    expect(estNomEmojiValide('a')).toBe(false);
    expect(estNomEmojiValide('a-b')).toBe(false);
    expect(estNomEmojiValide('x'.repeat(33))).toBe(false);
  });

  it('n’accepte que les types MIME du contrat', () => {
    expect(estMimeEmojiValide('image/gif')).toBe(true);
    expect(estMimeEmojiValide('image/webp')).toBe(true);
    expect(estMimeEmojiValide('image/svg+xml')).toBe(false);
  });
});

describe('jetons et valeurs de réaction', () => {
  it('écrit `:name:` dans le texte et `":name:"` en réaction', () => {
    expect(jetonEmojiTexte('parrot')).toBe(':parrot:');
    expect(valeurReactionEmoji('parrot')).toBe('":parrot:"');
  });

  it('extrait le nom d’une valeur de réaction custom, null sinon', () => {
    expect(nomReactionEmoji('":parrot:"')).toBe('parrot');
    expect(nomReactionEmoji(':parrot:')).toBeNull();
    expect(nomReactionEmoji('👍')).toBeNull();
  });

  it('convertit un choix en jeton texte et en valeur de réaction', () => {
    expect(jetonTexteEmoji({ kind: 'unicode', char: '🎉' })).toBe('🎉');
    expect(valeurReaction({ kind: 'unicode', char: '🎉' })).toBe('🎉');
    expect(jetonTexteEmoji({ kind: 'custom', name: 'wave', merkleRoot: 'r' })).toBe(
      ':wave:',
    );
    expect(valeurReaction({ kind: 'custom', name: 'wave', merkleRoot: 'r' })).toBe(
      '":wave:"',
    );
  });
});
