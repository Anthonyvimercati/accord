/**
 * Résolution des résultats de `search.query` : le nœud ne rend que des
 * `msg_id` (index HMAC aveugle) ; on les retrouve dans les historiques déjà
 * chargés pour proposer des résultats cliquables (extrait + conversation).
 */

import type { DmMessage, GroupMessage } from './api';

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
