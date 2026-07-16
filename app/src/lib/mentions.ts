/**
 * Pure helpers backing the @mention autocomplete: detecting the active
 * "@query" token at the caret, ranking candidates, and splicing a chosen
 * mention back into the composer text. No React and no store access — this
 * module is trivially unit-testable.
 */

import type { GroupMember, GroupRole } from './api';

/** Kind of a mention target, driving its icon and pill styling. */
export type MentionKind = 'everyone' | 'here' | 'role' | 'member';

/** A single suggestion shown in the autocomplete popup. */
export interface MentionCandidate {
  /** Stable React key. */
  id: string;
  /** Text inserted after '@' (no leading '@'). */
  value: string;
  /** Primary label shown in the list. */
  label: string;
  kind: MentionKind;
  /** Member public key (avatar/colour lookups); absent for roles/broadcasts. */
  pubkey?: string;
  /** Role colour (`0xRRGGBB`, `0` = none); absent for non-roles. */
  color?: number;
}

/** An active mention query ending at the caret. */
export interface ActiveMention {
  /** Index of the triggering '@' in the text. */
  start: number;
  /** Raw text between '@' and the caret (may be empty). */
  query: string;
}

/** Word character allowed inside a mention token (matches the markdown parser). */
const MENTION_CHAR = /[\p{L}\p{N}_-]/u;

/**
 * Finds the '@mention' token the caret sits in, or `null`. The token starts
 * at an '@' that is at the very start of the text or preceded by whitespace
 * (so emails like `a@b` never trigger it) and contains only mention chars up
 * to the caret.
 */
export function findActiveMention(text: string, caret: number): ActiveMention | null {
  let i = Math.min(caret, text.length) - 1;
  while (i >= 0) {
    const ch = text[i] ?? '';
    if (ch === '@') {
      const before = i > 0 ? (text[i - 1] ?? '') : '';
      if (i === 0 || /\s/.test(before)) {
        return { start: i, query: text.slice(i + 1, caret) };
      }
      return null;
    }
    if (!MENTION_CHAR.test(ch)) return null;
    i -= 1;
  }
  return null;
}

/** Rank: lower is better. Prefix matches beat plain substring matches. */
function rank(candidate: MentionCandidate, query: string): number {
  if (query === '') return 0;
  const label = candidate.label.toLowerCase();
  const value = candidate.value.toLowerCase();
  return value.startsWith(query) || label.startsWith(query) ? 0 : 1;
}

/**
 * Filters candidates whose value/label contains `query` (case-insensitive),
 * prefix matches first, ties preserving input order, capped at `limit`.
 */
export function filterMentions(
  candidates: readonly MentionCandidate[],
  query: string,
  limit = 8,
): MentionCandidate[] {
  const q = query.toLowerCase();
  return candidates
    .filter((c) => c.value.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c, q) - rank(b.c, q) || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}

/**
 * Splices `candidate` in place of the active token, appending a trailing
 * space. Returns the new text and the caret offset after the mention.
 */
export function insertMention(
  text: string,
  active: ActiveMention,
  candidate: MentionCandidate,
): { text: string; caret: number } {
  const before = text.slice(0, active.start);
  const after = text.slice(active.start + 1 + active.query.length);
  const token = `@${candidate.value} `;
  return { text: before + token + after, caret: before.length + token.length };
}

/**
 * Builds the candidate list for a group: the two broadcast mentions, then the
 * roles (in the order given by the caller), then the members. `nameOf`
 * resolves a member's display name.
 */
export function groupMentionCandidates(
  members: readonly GroupMember[],
  roles: readonly GroupRole[],
  nameOf: (pubkey: string) => string,
): MentionCandidate[] {
  const candidates: MentionCandidate[] = [
    { id: 'everyone', value: 'everyone', label: '@everyone', kind: 'everyone' },
    { id: 'here', value: 'here', label: '@here', kind: 'here' },
  ];
  for (const role of roles) {
    candidates.push({
      id: `role:${role.role_id}`,
      value: role.name,
      label: role.name,
      kind: 'role',
      color: role.color,
    });
  }
  for (const member of members) {
    const label = nameOf(member.pubkey);
    candidates.push({
      id: `member:${member.pubkey}`,
      value: label,
      label,
      kind: 'member',
      pubkey: member.pubkey,
    });
  }
  return candidates;
}
