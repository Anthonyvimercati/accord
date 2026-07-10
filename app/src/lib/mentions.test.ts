/**
 * Tests des aides pures d'autocomplétion de mentions : détection du jeton
 * actif au curseur, filtrage/tri des candidats, insertion dans le texte, et
 * construction de la liste de candidats d'un groupe.
 */

import { describe, expect, it } from 'vitest';
import type { GroupMember, GroupRole } from './api';
import {
  filterMentions,
  findActiveMention,
  groupMentionCandidates,
  insertMention,
  type MentionCandidate,
} from './mentions';

describe('findActiveMention', () => {
  it('detects an @ token at the start of the text', () => {
    expect(findActiveMention('@al', 3)).toEqual({ start: 0, query: 'al' });
  });

  it('detects an @ token preceded by whitespace', () => {
    expect(findActiveMention('salut @bo', 9)).toEqual({ start: 6, query: 'bo' });
  });

  it('returns an empty query right after the @', () => {
    expect(findActiveMention('hi @', 4)).toEqual({ start: 3, query: '' });
  });

  it('does not trigger on an email-like @ (no leading boundary)', () => {
    expect(findActiveMention('a@b', 3)).toBeNull();
  });

  it('closes the token once a space is typed', () => {
    expect(findActiveMention('@al ', 4)).toBeNull();
  });

  it('reads the query up to the caret, not the whole word', () => {
    expect(findActiveMention('@alice', 3)).toEqual({ start: 0, query: 'al' });
  });
});

describe('filterMentions', () => {
  const candidates: MentionCandidate[] = [
    { id: 'everyone', value: 'everyone', label: '@everyone', kind: 'everyone' },
    { id: 'here', value: 'here', label: '@here', kind: 'here' },
    { id: 'r1', value: 'Mods', label: 'Mods', kind: 'role', color: 0 },
    { id: 'm1', value: 'Alice', label: 'Alice', kind: 'member', pubkey: 'pk1' },
    { id: 'm2', value: 'Alan', label: 'Alan', kind: 'member', pubkey: 'pk2' },
  ];

  it('returns every candidate for an empty query', () => {
    expect(filterMentions(candidates, '')).toHaveLength(5);
  });

  it('matches case-insensitively on value/label', () => {
    const names = filterMentions(candidates, 'al').map((c) => c.value);
    expect(names).toEqual(['Alice', 'Alan']);
  });

  it('ranks prefix matches ahead of substring matches', () => {
    const list: MentionCandidate[] = [
      { id: 'a', value: 'xher', label: 'xher', kind: 'member', pubkey: 'a' },
      { id: 'b', value: 'here', label: 'here', kind: 'here' },
    ];
    expect(filterMentions(list, 'her').map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('caps the result at the given limit', () => {
    expect(filterMentions(candidates, '', 2)).toHaveLength(2);
  });
});

describe('insertMention', () => {
  it('splices the mention with a trailing space and returns the caret', () => {
    const active = { start: 6, query: 'al' };
    const candidate: MentionCandidate = {
      id: 'm1',
      value: 'Alice',
      label: 'Alice',
      kind: 'member',
      pubkey: 'pk1',
    };
    const result = insertMention('salut @al', active, candidate);
    expect(result.text).toBe('salut @Alice ');
    expect(result.caret).toBe('salut @Alice '.length);
  });

  it('keeps trailing text after the token', () => {
    const active = { start: 0, query: 'ev' };
    const candidate: MentionCandidate = {
      id: 'everyone',
      value: 'everyone',
      label: '@everyone',
      kind: 'everyone',
    };
    expect(insertMention('@ev !', active, candidate).text).toBe('@everyone  !');
  });
});

describe('groupMentionCandidates', () => {
  const members: GroupMember[] = [{ pubkey: 'pk_alice', roles: [] }];
  const roles: GroupRole[] = [
    { role_id: 'r1', name: 'Mods', color: 0xff0000, position: 1, permissions: 0 },
  ];

  it('lists broadcasts first, then roles, then members', () => {
    const list = groupMentionCandidates(members, roles, () => 'Alice');
    expect(list.map((c) => c.kind)).toEqual(['everyone', 'here', 'role', 'member']);
    expect(list[2]).toMatchObject({ value: 'Mods', color: 0xff0000 });
    expect(list[3]).toMatchObject({ value: 'Alice', pubkey: 'pk_alice' });
  });
});
