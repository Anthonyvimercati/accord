/**
 * Tests des bornes de sondage (`groups.send` étendu, D-048) : validation en
 * octets UTF-8 (pas en caractères) de la question et des options.
 */

import { describe, expect, it } from 'vitest';
import {
  estOptionsSondageValides,
  estOptionSondageValide,
  estQuestionSondageValide,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
  utf8ByteLength,
} from './poll';

describe('utf8ByteLength', () => {
  it('compte 1 octet par caractère ASCII', () => {
    expect(utf8ByteLength('abc')).toBe(3);
  });

  it('compte plusieurs octets pour un caractère multi-octets (émoji, accent)', () => {
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('🎉')).toBe(4);
  });
});

describe('estQuestionSondageValide', () => {
  it('accepte une question non vide sous la borne', () => {
    expect(estQuestionSondageValide('Pizza ou sushis ?')).toBe(true);
  });

  it('rejette une question vide ou faite uniquement d’espaces', () => {
    expect(estQuestionSondageValide('')).toBe(false);
    expect(estQuestionSondageValide('   ')).toBe(false);
  });

  it('rejette une question au-delà de 300 octets UTF-8', () => {
    expect(estQuestionSondageValide('a'.repeat(POLL_QUESTION_MAX))).toBe(true);
    expect(estQuestionSondageValide('a'.repeat(POLL_QUESTION_MAX + 1))).toBe(false);
  });

  it('compte les octets, pas les caractères — un texte truffé d’émojis peut dépasser la borne en octets sans dépasser 300 caractères', () => {
    // Chaque 🎉 pèse 4 octets : 76 emojis = 304 octets > 300, alors que la
    // chaîne ne fait que 76 caractères (bien sous une borne naïve en longueur).
    const question = '🎉'.repeat(76);
    expect(question.length).toBeLessThan(POLL_QUESTION_MAX);
    expect(estQuestionSondageValide(question)).toBe(false);
  });
});

describe('estOptionSondageValide', () => {
  it('accepte une option non vide sous la borne', () => {
    expect(estOptionSondageValide('Pizza')).toBe(true);
  });

  it('rejette une option vide', () => {
    expect(estOptionSondageValide('  ')).toBe(false);
  });

  it('rejette une option au-delà de 100 octets UTF-8', () => {
    expect(estOptionSondageValide('a'.repeat(POLL_OPTION_MAX))).toBe(true);
    expect(estOptionSondageValide('a'.repeat(POLL_OPTION_MAX + 1))).toBe(false);
  });
});

describe('estOptionsSondageValides', () => {
  it('accepte entre 2 et 10 options valides', () => {
    expect(estOptionsSondageValides(['Pizza', 'Sushis'])).toBe(true);
    expect(estOptionsSondageValides(Array.from({ length: POLL_MAX_OPTIONS }, () => 'x'))).toBe(
      true,
    );
  });

  it('rejette moins de 2 options', () => {
    expect(estOptionsSondageValides(['Pizza'])).toBe(false);
    expect(estOptionsSondageValides([])).toBe(false);
  });

  it('rejette plus de 10 options', () => {
    expect(
      estOptionsSondageValides(Array.from({ length: POLL_MAX_OPTIONS + 1 }, () => 'x')),
    ).toBe(false);
  });

  it('rejette si une seule option est invalide', () => {
    expect(estOptionsSondageValides(['Pizza', ''])).toBe(false);
  });

  it('POLL_MIN_OPTIONS vaut 2', () => {
    expect(POLL_MIN_OPTIONS).toBe(2);
  });
});
