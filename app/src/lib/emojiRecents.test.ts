/**
 * Tests des émojis récents : ajout en tête, déduplication (Unicode par
 * caractère, custom par nom), bornage, immuabilité, désérialisation tolérante
 * et aller-retour de persistance.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { EmojiPick } from './emoji';
import {
  addRecent,
  MAX_RECENTS,
  parseRecents,
  readRecents,
  RECENTS_STORAGE_KEY,
  writeRecents,
} from './emojiRecents';

const thumb: EmojiPick = { kind: 'unicode', char: '👍' };
const heart: EmojiPick = { kind: 'unicode', char: '❤️' };
const parrot: EmojiPick = { kind: 'custom', name: 'parrot', merkleRoot: 'racine' };

describe('addRecent', () => {
  it('ajoute le choix en tête de liste', () => {
    expect(addRecent([heart], thumb)).toEqual([thumb, heart]);
  });

  it('déduplique un Unicode déjà présent en le remettant en tête', () => {
    expect(addRecent([heart, thumb], thumb)).toEqual([thumb, heart]);
  });

  it('déduplique un custom par son nom (racine ignorée)', () => {
    const other: EmojiPick = { kind: 'custom', name: 'parrot', merkleRoot: 'autre' };
    expect(addRecent([parrot, heart], other)).toEqual([other, heart]);
  });

  it('borne la liste au maximum, en gardant les plus récents', () => {
    const many: EmojiPick[] = Array.from({ length: MAX_RECENTS }, (_, i) => ({
      kind: 'unicode',
      char: `e${i}`,
    }));
    const next = addRecent(many, thumb);

    expect(next).toHaveLength(MAX_RECENTS);
    expect(next[0]).toEqual(thumb);
    expect(next.at(-1)).toEqual({ kind: 'unicode', char: `e${MAX_RECENTS - 2}` });
  });

  it('ne mute pas la liste d’entrée', () => {
    const list: EmojiPick[] = [heart];
    addRecent(list, thumb);
    expect(list).toEqual([heart]);
  });
});

describe('parseRecents', () => {
  it('ignore une valeur non tableau', () => {
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents('boom')).toEqual([]);
  });

  it('filtre les entrées invalides et conserve les valides', () => {
    const raw = [thumb, { kind: 'unicode' }, { kind: 'custom', name: 'x' }, parrot];
    expect(parseRecents(raw)).toEqual([thumb, parrot]);
  });

  it('borne la liste désérialisée', () => {
    const raw: EmojiPick[] = Array.from({ length: MAX_RECENTS + 5 }, (_, i) => ({
      kind: 'unicode',
      char: `e${i}`,
    }));
    expect(parseRecents(raw)).toHaveLength(MAX_RECENTS);
  });
});

describe('readRecents / writeRecents', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('rend une liste vide quand rien n’est stocké', () => {
    expect(readRecents()).toEqual([]);
  });

  it('effectue un aller-retour de persistance', () => {
    writeRecents([thumb, parrot]);
    expect(readRecents()).toEqual([thumb, parrot]);
  });

  it('rend une liste vide sur contenu corrompu', () => {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, '{not json');
    expect(readRecents()).toEqual([]);
  });
});
