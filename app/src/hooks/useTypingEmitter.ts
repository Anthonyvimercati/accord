/**
 * Émission de l'indicateur de frappe pendant la saisie : au plus un appel
 * API toutes les TYPING_EMIT_INTERVAL_MS par conversation (le nœud borne de
 * son côté à un événement toutes les 2 s par pair), best effort (échec
 * ignoré en silence), rien pour un texte vide.
 */

import { useCallback, useEffect, useRef } from 'react';
import { api } from '../lib/client';

/** Intervalle minimal entre deux émissions (aligné sur la borne du nœud). */
export const TYPING_EMIT_INTERVAL_MS = 2000;

/** Conversation cible de l'indicateur de frappe (MP ou salon de groupe). */
export type TypingTarget =
  { kind: 'dm'; peer: string } | { kind: 'group'; groupId: string; channelId: string };

/** Identité stable d'une cible, pour réinitialiser le throttle au changement. */
function targetKey(target: TypingTarget | undefined): string | null {
  if (target === undefined) return null;
  return target.kind === 'dm'
    ? `dm:${target.peer}`
    : `group:${target.groupId}/${target.channelId}`;
}

/**
 * Rend un rappel à invoquer à chaque frappe avec le texte courant : il émet
 * `dm.typing` ou `groups.typing` selon la cible, throttlé côté client.
 */
export function useTypingEmitter(
  target: TypingTarget | undefined,
): (text: string) => void {
  const targetRef = useRef<TypingTarget | undefined>(target);
  /** Horodatage de la dernière émission (`null` : aucune encore). */
  const lastSentRef = useRef<number | null>(null);
  const key = targetKey(target);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  // Changement de conversation : le throttle repart de zéro.
  useEffect(() => {
    lastSentRef.current = null;
  }, [key]);

  return useCallback((text: string) => {
    const cible = targetRef.current;
    if (cible === undefined || text.trim() === '') return;
    const now = Date.now();
    if (
      lastSentRef.current !== null &&
      now - lastSentRef.current < TYPING_EMIT_INTERVAL_MS
    ) {
      return;
    }
    lastSentRef.current = now;
    const emission =
      cible.kind === 'dm'
        ? api.dmTyping(cible.peer)
        : api.groupsTyping(cible.groupId, cible.channelId);
    emission.catch(() => {
      // Best effort : un indicateur perdu est sans conséquence.
    });
  }, []);
}
