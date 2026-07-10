/**
 * Indicateurs de frappe éphémères : chaque `event.dm_typing` /
 * `event.group_typing` (câblés dans AppShell) (re)note l'écrivain pour sa
 * conversation avec une échéance. Sans réémission avant l'échéance (le nœud
 * borne à un événement toutes les 2 s par pair), l'entrée expire d'elle-même.
 */

import { create } from 'zustand';

/** Durée de vie d'un indicateur sans nouvel événement (timer réarmé). */
export const TYPING_EXPIRY_MS = 4000;

/** Clé de conversation d'un message privé. */
export function dmTypingKey(peer: string): string {
  return `dm:${peer}`;
}

/** Clé de conversation d'un salon de groupe. */
export function groupTypingKey(groupId: string, channelId: string): string {
  return `group:${groupId}/${channelId}`;
}

/** Échéances par conversation : clé → { pubkey → timestamp d'expiration }. */
type Writers = Record<string, Record<string, number>>;

/** Copie de `writers` sans l'écrivain `pubkey` de `key` (map vide retirée). */
function withoutWriter(writers: Writers, key: string, pubkey: string): Writers {
  const conversation = writers[key];
  if (conversation === undefined || conversation[pubkey] === undefined) return writers;
  const rest = Object.fromEntries(
    Object.entries(conversation).filter(([p]) => p !== pubkey),
  );
  if (Object.keys(rest).length === 0) {
    return Object.fromEntries(Object.entries(writers).filter(([k]) => k !== key));
  }
  return { ...writers, [key]: rest };
}

interface TypingState {
  /** Écrivains en cours par conversation (échéances en ms epoch). */
  writers: Writers;
  /** (Re)note un écrivain : pose l'échéance et arme le timer d'expiration. */
  noteTyping: (key: string, pubkey: string) => void;
}

export const useTyping = create<TypingState>((set, get) => ({
  writers: {},

  noteTyping: (key, pubkey) => {
    const deadline = Date.now() + TYPING_EXPIRY_MS;
    set((s) => ({
      writers: {
        ...s.writers,
        [key]: { ...(s.writers[key] ?? {}), [pubkey]: deadline },
      },
    }));
    setTimeout(() => {
      const current = get().writers[key]?.[pubkey];
      // Échéance repoussée entre-temps : un timer plus tardif s'en chargera.
      if (current === undefined || current > Date.now()) return;
      set((s) => ({ writers: withoutWriter(s.writers, key, pubkey) }));
    }, TYPING_EXPIRY_MS);
  },
}));
