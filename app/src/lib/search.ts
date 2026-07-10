/**
 * Résolution des résultats de `search.query` : le nœud ne rend que des
 * `msg_id` (index HMAC aveugle) ; on les retrouve dans les historiques déjà
 * chargés pour proposer des résultats cliquables (extrait + conversation).
 */

import type { DmMessage, GroupMessage, SearchQueryHit } from './api';

/** Filtre de recherche reconnu dans la barre (`from:`, `in:`, `has:`, …). */
export type SearchChipType = 'from' | 'in' | 'has' | 'before' | 'after';

/** Un filtre affiché en pastille sous la barre de recherche. */
export interface SearchChip {
  type: SearchChipType;
  value: string;
}

/** Association clé de filtre (minuscule) → type de pastille (grammaire nœud). */
const CHIP_KEYS: Readonly<Record<string, SearchChipType>> = {
  from: 'from',
  in: 'in',
  has: 'has',
  before: 'before',
  after: 'after',
};

/**
 * Découpe une requête en jetons séparés par des espaces, en préservant les
 * valeurs entre guillemets (`from:"John Doe"` reste un seul jeton).
 */
function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  for (const ch of query) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === ' ' && !inQuote) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

/**
 * Repère les filtres `clé:valeur` reconnus dans la requête, pour les afficher
 * en pastilles à la frappe. Purement présentationnel : le nœud reste seul juge
 * de la grammaire (les mots simples et filtres inconnus sont ignorés ici).
 */
export function parseSearchChips(query: string): SearchChip[] {
  const chips: SearchChip[] = [];
  for (const token of tokenizeQuery(query)) {
    const separator = token.indexOf(':');
    if (separator <= 0) continue;
    const type = CHIP_KEYS[token.slice(0, separator).toLowerCase()];
    if (type === undefined) continue;
    const value = token.slice(separator + 1);
    if (value === '') continue;
    chips.push({ type, value });
  }
  return chips;
}

/** Conversation cible d'un résultat de recherche. */
export type SearchLocation =
  { kind: 'dm'; peer: string } | { kind: 'group'; groupId: string; channelId: string };

/** Résultat résolu, prêt à afficher. */
export interface SearchHit {
  msgId: string;
  location: SearchLocation;
  author: string;
  sentMs: number;
  text: string;
}

/** Résultats d'une recherche : extraits résolus + nombre d'introuvables. */
export interface SearchResolution {
  hits: SearchHit[];
  /** Identifiants hors des historiques chargés (ou sans texte affichable). */
  unresolved: number;
}

/** Texte affichable d'un message (dernière édition prioritaire). */
function displayText(message: DmMessage | GroupMessage): string | null {
  if (message.deleted) return null;
  if (message.edited !== null) return message.edited;
  return message.body.type === 'text' ? message.body.text : null;
}

/**
 * Croise les identifiants rendus par le nœud avec les historiques chargés.
 * `groupMessages` est indexé par `groupId/channelId` (clé des stores).
 */
export function resolveSearchHits(
  msgIds: readonly string[],
  dms: Record<string, readonly DmMessage[]>,
  groupMessages: Record<string, readonly GroupMessage[]>,
): SearchResolution {
  const index = new Map<string, SearchHit>();

  for (const [peer, messages] of Object.entries(dms)) {
    for (const m of messages) {
      const text = displayText(m);
      if (text === null) continue;
      index.set(m.msg_id, {
        msgId: m.msg_id,
        location: { kind: 'dm', peer },
        author: m.author,
        sentMs: m.sent_ms,
        text,
      });
    }
  }

  for (const [key, messages] of Object.entries(groupMessages)) {
    const separator = key.indexOf('/');
    if (separator < 0) continue;
    const groupId = key.slice(0, separator);
    const channelId = key.slice(separator + 1);
    for (const m of messages) {
      const text = displayText(m);
      if (text === null) continue;
      index.set(m.msg_id, {
        msgId: m.msg_id,
        location: { kind: 'group', groupId, channelId },
        author: m.author,
        sentMs: m.sent_ms,
        text,
      });
    }
  }

  const hits: SearchHit[] = [];
  let unresolved = 0;
  for (const id of msgIds) {
    const hit = index.get(id);
    if (hit) hits.push(hit);
    else unresolved++;
  }
  // Les plus récents d'abord, comme un fil de résultats Discord.
  hits.sort((a, b) => b.sentMs - a.sentMs);
  return { hits, unresolved };
}

/**
 * Indexe le texte affichable des messages chargés par `msg_id`. Sert à hydrater
 * les résultats `search.query` (le nœud ne rend que des métadonnées, jamais le
 * corps) avec un extrait quand la conversation est déjà ouverte localement.
 */
export function indexMessageText(
  dms: Record<string, readonly DmMessage[]>,
  groupMessages: Record<string, readonly GroupMessage[]>,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const messages of Object.values(dms)) {
    for (const m of messages) {
      const text = displayText(m);
      if (text !== null) index.set(m.msg_id, text);
    }
  }
  for (const messages of Object.values(groupMessages)) {
    for (const m of messages) {
      const text = displayText(m);
      if (text !== null) index.set(m.msg_id, text);
    }
  }
  return index;
}

/** Résultat `search.query` prêt à afficher : métadonnées + extrait éventuel. */
export interface SearchHitRow {
  hit: SearchQueryHit;
  /** Extrait local (`null` si la conversation n'est pas chargée). */
  text: string | null;
}

/**
 * Associe à chaque résultat du nœud (déjà triés du plus récent au plus ancien)
 * son extrait local s'il est disponible. Tous les résultats sont conservés :
 * un message hors des historiques chargés s'affiche par ses seules métadonnées.
 */
export function buildHitRows(
  hits: readonly SearchQueryHit[],
  textIndex: ReadonlyMap<string, string>,
): SearchHitRow[] {
  return hits.map((hit) => ({ hit, text: textIndex.get(hit.msg_id) ?? null }));
}
