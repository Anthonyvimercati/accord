/**
 * Sourdine (mute) locale des serveurs et salons — jamais synchronisée avec
 * le nœud ni les autres appareils, comme les autres préférences d'interface
 * (voir `stores/ui.ts` pour le patron de persistance localStorage réutilisé
 * ici : lecture tolérante, écriture best effort).
 *
 * Choix produit MVP délibéré : une sourdine coupe *totalement* le son et la
 * notification native du périmètre concerné (serveur entier ou un seul
 * salon) — pas d'exception « les mentions notifient quand même », pour
 * rester simple à ce stade. Le compteur de non-lu continue d'être tenu
 * normalement par les stores `groups`/`friends` (aucune donnée ici) ; seule
 * la couche de notification (`lib/notifications.ts`, consommée par
 * `AppShell`) consulte ce store pour supprimer le son/la notification
 * native — voir `isConversationMuted`.
 *
 * Les MP ne sont pas mis en sourdine dans cette version : ni `ServerRail`
 * ni `Sidebar` n'exposent de sourdine par contact (hors périmètre) —
 * `isConversationMuted` renvoie toujours `false` pour `{ kind: 'dm' }`.
 *
 * Un salon (`channel_id`) n'est pas garanti unique tous serveurs confondus :
 * les identifiants de salon en sourdine sont donc stockés sous la clé
 * composite `channelKey(groupId, channelId)` déjà utilisée par le store
 * `groups` (historiques, non-lus, épinglés) plutôt que le seul `channel_id`.
 */

import { create } from 'zustand';
import type { ConversationRef } from '../lib/notifications';
import { channelKey } from './groups';

const STORAGE_KEYS = {
  servers: 'accord.mute.servers',
  channels: 'accord.mute.channels',
} as const;

/** Lecture localStorage tolérante d'une liste d'identifiants (JSON, best effort). */
function readStoredIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

/** Écriture localStorage tolérante (sourdine non persistée en cas d'échec). */
function writeStoredIds(key: string, ids: readonly string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Best effort : la sourdine reste appliquée pour la session en cours.
  }
}

/** Ajoute/retire `id` de la liste — jamais de mutation en place. */
function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];
}

/** Vrai si le serveur `groupId` est en sourdine. Pure — testable en isolation. */
export function isServerMuted(mutedServers: readonly string[], groupId: string): boolean {
  return mutedServers.includes(groupId);
}

/**
 * Vrai si le salon `channelId` (du serveur `groupId`) est individuellement en
 * sourdine — indépendant de la sourdine du serveur entier (voir
 * `isConversationMuted` pour la combinaison des deux au moment de notifier).
 */
export function isChannelMuted(
  mutedChannels: readonly string[],
  groupId: string,
  channelId: string,
): boolean {
  return mutedChannels.includes(channelKey(groupId, channelId));
}

interface MuteState {
  /** Identifiants (`groupId`) des serveurs en sourdine. */
  mutedServers: string[];
  /** Clés composites `channelKey(groupId, channelId)` des salons en sourdine. */
  mutedChannels: string[];
  /** Bascule la sourdine du serveur entier (menu contextuel de `ServerRail`). */
  toggleServerMute: (groupId: string) => void;
  /** Bascule la sourdine d'un seul salon (menu contextuel de `Sidebar`). */
  toggleChannelMute: (groupId: string, channelId: string) => void;
}

export const useMute = create<MuteState>((set) => ({
  mutedServers: readStoredIds(STORAGE_KEYS.servers),
  mutedChannels: readStoredIds(STORAGE_KEYS.channels),

  toggleServerMute: (groupId) =>
    set((s) => {
      const mutedServers = toggleId(s.mutedServers, groupId);
      writeStoredIds(STORAGE_KEYS.servers, mutedServers);
      return { mutedServers };
    }),

  toggleChannelMute: (groupId, channelId) =>
    set((s) => {
      const mutedChannels = toggleId(s.mutedChannels, channelKey(groupId, channelId));
      writeStoredIds(STORAGE_KEYS.channels, mutedChannels);
      return { mutedChannels };
    }),
}));

/**
 * Vrai si la conversation notifiée `ref` doit être tue (son + notification
 * native) : le serveur entier ou le salon précis est en sourdine — consultée
 * par `AppShell` avant `isNotificationEligible`/`isSoundEligible` (voir
 * commentaire de tête : les MP ne sont jamais mis en sourdine ici).
 */
export function isConversationMuted(ref: ConversationRef): boolean {
  if (ref.kind === 'dm') return false;
  const { mutedServers, mutedChannels } = useMute.getState();
  return (
    isServerMuted(mutedServers, ref.groupId) ||
    isChannelMuted(mutedChannels, ref.groupId, ref.channelId)
  );
}
