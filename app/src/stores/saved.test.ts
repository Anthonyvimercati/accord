/** Tests du store des messages enregistrés : bascule, unicité, persistance. */

import { beforeEach, describe, expect, it } from 'vitest';
import { useSaved, type SavedMessage } from './saved';

const entry = (msgId: string): Omit<SavedMessage, 'savedAt'> => ({
  msgId,
  view: { kind: 'dm', peer: 'abc' },
  author: 'abc',
  text: `texte ${msgId}`,
  ts: 1000,
});

beforeEach(() => {
  window.localStorage.clear();
  useSaved.setState({ items: [] });
});

describe('useSaved', () => {
  it('enregistre puis retire par bascule', () => {
    useSaved.getState().toggle(entry('m1'), 10);
    expect(useSaved.getState().isSaved('m1')).toBe(true);
    expect(useSaved.getState().items).toHaveLength(1);

    useSaved.getState().toggle(entry('m1'), 20);
    expect(useSaved.getState().isSaved('m1')).toBe(false);
    expect(useSaved.getState().items).toHaveLength(0);
  });

  it('place le plus récent en tête', () => {
    useSaved.getState().toggle(entry('m1'), 10);
    useSaved.getState().toggle(entry('m2'), 20);
    expect(useSaved.getState().items[0]?.msgId).toBe('m2');
    expect(useSaved.getState().items[0]?.savedAt).toBe(20);
  });

  it('persiste dans localStorage et se recharge', () => {
    useSaved.getState().toggle(entry('m1'), 10);
    const brut = window.localStorage.getItem('accord.saved');
    expect(brut).not.toBeNull();
    expect(JSON.parse(brut ?? '[]')).toHaveLength(1);
  });

  it('retire par identifiant et vide tout', () => {
    useSaved.getState().toggle(entry('m1'), 10);
    useSaved.getState().toggle(entry('m2'), 20);
    useSaved.getState().remove('m1');
    expect(useSaved.getState().isSaved('m1')).toBe(false);
    expect(useSaved.getState().items).toHaveLength(1);
    useSaved.getState().clear();
    expect(useSaved.getState().items).toHaveLength(0);
  });

  it('tolère un stockage malformé sans planter', () => {
    window.localStorage.setItem('accord.saved', '{pas du json');
    expect(() => useSaved.getState().isSaved('x')).not.toThrow();
    useSaved.getState().toggle(entry('m1'), 10);
    expect(useSaved.getState().isSaved('m1')).toBe(true);
  });
});
