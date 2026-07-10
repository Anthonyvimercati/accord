/**
 * Tests du store des indicateurs de frappe : notation d'un écrivain,
 * expiration après TYPING_EXPIRY_MS sans nouvel événement, réarmement du
 * timer à chaque événement et indépendance des conversations.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTyping, dmTypingKey, groupTypingKey, TYPING_EXPIRY_MS } from './typing';

function writersOf(key: string): string[] {
  return Object.keys(useTyping.getState().writers[key] ?? {});
}

beforeEach(() => {
  vi.useFakeTimers();
  useTyping.setState({ writers: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useTyping.noteTyping', () => {
  it('note un écrivain pour sa conversation', () => {
    // Arrange
    const key = dmTypingKey('alice-pk');

    // Act
    useTyping.getState().noteTyping(key, 'alice-pk');

    // Assert
    expect(writersOf(key)).toEqual(['alice-pk']);
  });

  it("retire l'écrivain après l'échéance sans nouvel événement", () => {
    // Arrange
    const key = dmTypingKey('alice-pk');
    useTyping.getState().noteTyping(key, 'alice-pk');

    // Act
    vi.advanceTimersByTime(TYPING_EXPIRY_MS);

    // Assert : la conversation vidée disparaît entièrement.
    expect(useTyping.getState().writers[key]).toBeUndefined();
  });

  it("réarme l'échéance à chaque événement reçu", () => {
    // Arrange
    const key = dmTypingKey('alice-pk');
    useTyping.getState().noteTyping(key, 'alice-pk');
    vi.advanceTimersByTime(TYPING_EXPIRY_MS - 1000);

    // Act : nouvel événement avant l'échéance, puis premier timer échu.
    useTyping.getState().noteTyping(key, 'alice-pk');
    vi.advanceTimersByTime(1000);

    // Assert : toujours noté (échéance repoussée)…
    expect(writersOf(key)).toEqual(['alice-pk']);

    // …puis expiré à la nouvelle échéance.
    vi.advanceTimersByTime(TYPING_EXPIRY_MS - 1000);
    expect(useTyping.getState().writers[key]).toBeUndefined();
  });

  it('suit plusieurs écrivains sans mélanger les conversations', () => {
    // Arrange
    const salon = groupTypingKey('g1', 'c1');
    const dm = dmTypingKey('carol-pk');

    // Act
    useTyping.getState().noteTyping(salon, 'alice-pk');
    useTyping.getState().noteTyping(salon, 'bob-pk');
    useTyping.getState().noteTyping(dm, 'carol-pk');

    // Assert
    expect(writersOf(salon)).toEqual(['alice-pk', 'bob-pk']);
    expect(writersOf(dm)).toEqual(['carol-pk']);
  });

  it("n'expire qu'un écrivain à la fois dans un même salon", () => {
    // Arrange : bob se manifeste 2 s après alice.
    const salon = groupTypingKey('g1', 'c1');
    useTyping.getState().noteTyping(salon, 'alice-pk');
    vi.advanceTimersByTime(2000);
    useTyping.getState().noteTyping(salon, 'bob-pk');

    // Act : l'échéance d'alice tombe, pas celle de bob.
    vi.advanceTimersByTime(TYPING_EXPIRY_MS - 2000);

    // Assert
    expect(writersOf(salon)).toEqual(['bob-pk']);
  });
});
