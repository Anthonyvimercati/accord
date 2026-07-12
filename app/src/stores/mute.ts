/**
 * Niveau de notification local des serveurs et salons — jamais synchronisé
 * avec le nœud ni les autres appareils, comme les autres préférences
 * d'interface (voir `stores/ui.ts` pour le patron de persistance localStorage
 * réutilisé ici : lecture tolérante, écriture best effort).
 *
 * Modèle à trois états (comme Discord), remplaçant l'ancienne sourdine binaire :
 *   - 'all'      : tout notifier (défaut) ;
 *   - 'mentions' : notifier seulement si le message me mentionne — ne concerne
 *                  que les salons de serveur (un MP est toujours « pour moi ») ;
 *   - 'none'     : rien (l'ancienne « sourdine » totale).
 *
 * Les niveaux sont stockés dans une table id→niveau sérialisée en JSON, une par
 * périmètre (serveurs et salons). Rétro-compatibilité : l'ancien format (liste
 * d'ids « mutés », `string[]`) est migré au premier chargement — chaque id
 * présent devient niveau 'none'.
 *
 * Seule la couche de notification (`AppShell`) consulte ce store, via
 * `isConversationSilenced`, pour supprimer le son et la notification native ;
 * le compteur de non-lu continue d'être tenu normalement par les stores
 * `groups`/`friends` (aucune donnée ici).
 *
 * Les MP ne sont pas réglés dans cette version : ni `ServerRail` ni `Sidebar`
 * n'exposent de niveau par contact (hors périmètre) — `isConversationSilenced`
 * renvoie toujours `false` pour `{ kind: 'dm' }`.
 *
 * Un salon (`channel_id`) n'est pas garanti unique tous serveurs confondus :
 * les niveaux de salon sont donc indexés sous la clé composite
 * `channelKey(groupId, channelId)` déjà utilisée par le store `groups`
 * (historiques, non-lus, épinglés) plutôt que le seul `channel_id`.
 */

import { create } from 'zustand';
import type { ConversationRef } from '../lib/notifications';
import { channelKey } from './groups';

/** Niveau de notification d'un périmètre (serveur ou salon). */
export type NotifLevel = 'all' | 'mentions' | 'none';

/** Niveau appliqué en l'absence de réglage explicite : tout notifier. */
const DEFAULT_LEVEL: NotifLevel = 'all';

const STORAGE_KEYS = {
  servers: 'accord.mute.servers',
  channels: 'accord.mute.channels',
} as const;

/** Table id→niveau (sérialisée JSON en localStorage). */
export type LevelMap = Record<string, NotifLevel>;

/** Sous-ensemble d'état lu par les fonctions pures (testable en isolation). */
export interface MuteLevels {
  serverLevels: LevelMap;
  channelLevels: LevelMap;
}

/** Garde de type : valeur issue du JSON stocké réellement un `NotifLevel`. */
function isNotifLevel(value: unknown): value is NotifLevel {
  return value === 'all' || value === 'mentions' || value === 'none';
}

/**
 * Lecture localStorage tolérante d'une table id→niveau. Rétro-compatibilité :
 * l'ancien format binaire (liste d'ids « mutés », `string[]`) est migré — chaque
 * id présent devient niveau 'none' (sourdine totale, comportement historique).
 * Toute valeur corrompue ou d'un type inattendu se replie sur une table vide.
 */
function readStoredLevels(key: string): LevelMap {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const out: LevelMap = {};
      for (const id of parsed) if (typeof id === 'string') out[id] = 'none';
      return out;
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const out: LevelMap = {};
      for (const [id, level] of Object.entries(parsed)) {
        if (isNotifLevel(level)) out[id] = level;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

/** Écriture localStorage tolérante (réglage non persisté en cas d'échec). */
function writeStoredLevels(key: string, levels: LevelMap): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(levels));
  } catch {
    // Best effort : le réglage reste appliqué pour la session en cours.
  }
}

/** Niveau du serveur `groupId` (défaut 'all'). Pure — testable en isolation. */
export function serverLevel(state: MuteLevels, groupId: string): NotifLevel {
  return state.serverLevels[groupId] ?? DEFAULT_LEVEL;
}

/**
 * Niveau effectif du salon `channelId` (du serveur `groupId`) : son réglage
 * propre s'il en a un, sinon héritage du niveau du serveur (défaut 'all').
 * Pure — voir `isConversationSilenced` pour l'usage au moment de notifier.
 */
export function channelLevel(
  state: MuteLevels,
  groupId: string,
  channelId: string,
): NotifLevel {
  const own = state.channelLevels[channelKey(groupId, channelId)];
  return own ?? serverLevel(state, groupId);
}

/** Nouvel état avec le niveau du serveur fixé — jamais de mutation en place. */
export function setServerLevel(
  state: MuteLevels,
  groupId: string,
  level: NotifLevel,
): MuteLevels {
  return { ...state, serverLevels: { ...state.serverLevels, [groupId]: level } };
}

/**
 * Nouvel état avec le niveau *propre* du salon fixé (override qui prime sur
 * l'héritage du serveur) — jamais de mutation en place.
 */
export function setChannelLevel(
  state: MuteLevels,
  groupId: string,
  channelId: string,
  level: NotifLevel,
): MuteLevels {
  return {
    ...state,
    channelLevels: {
      ...state.channelLevels,
      [channelKey(groupId, channelId)]: level,
    },
  };
}

/**
 * Compat : un serveur « en sourdine » = niveau 'none'. Conservé pour les
 * appelants historiques qui ne raisonnent qu'en muet/non-muet.
 */
export function isServerMuted(state: MuteLevels, groupId: string): boolean {
  return serverLevel(state, groupId) === 'none';
}

/** Compat : un salon « en sourdine » = niveau effectif 'none' (héritage inclus). */
export function isChannelMuted(
  state: MuteLevels,
  groupId: string,
  channelId: string,
): boolean {
  return channelLevel(state, groupId, channelId) === 'none';
}

interface MuteState extends MuteLevels {
  /** Fixe le niveau de notification du serveur entier (menu de `ServerRail`). */
  setServerLevel: (groupId: string, level: NotifLevel) => void;
  /** Fixe le niveau propre d'un salon (menu de `Sidebar`). */
  setChannelLevel: (groupId: string, channelId: string, level: NotifLevel) => void;
}

export const useMute = create<MuteState>((set) => ({
  serverLevels: readStoredLevels(STORAGE_KEYS.servers),
  channelLevels: readStoredLevels(STORAGE_KEYS.channels),

  setServerLevel: (groupId, level) =>
    set((s) => {
      const { serverLevels } = setServerLevel(s, groupId, level);
      writeStoredLevels(STORAGE_KEYS.servers, serverLevels);
      return { serverLevels };
    }),

  setChannelLevel: (groupId, channelId, level) =>
    set((s) => {
      const { channelLevels } = setChannelLevel(s, groupId, channelId, level);
      writeStoredLevels(STORAGE_KEYS.channels, channelLevels);
      return { channelLevels };
    }),
}));

/**
 * Décide si le message entrant `ref` (mentionnant `mentionsMe` l'utilisateur ou
 * non) doit être tu — son *et* notification native supprimés — selon le niveau
 * effectif du salon (héritage salon←serveur appliqué par `channelLevel`) :
 *   - 'none'     → toujours tu (ancienne sourdine totale) ;
 *   - 'mentions' → tu sauf si le message me mentionne ;
 *   - 'all'      → jamais tu.
 * Les MP restent hors périmètre (jamais tus ici) : un MP est toujours « pour
 * moi », donc le niveau 'mentions' n'a de sens que pour les salons de serveur.
 * Consultée par `AppShell` avant `isNotificationEligible`/`isSoundEligible`.
 */
export function isConversationSilenced(
  ref: ConversationRef,
  mentionsMe: boolean,
): boolean {
  if (ref.kind === 'dm') return false;
  const level = channelLevel(useMute.getState(), ref.groupId, ref.channelId);
  if (level === 'none') return true;
  if (level === 'mentions') return !mentionsMe;
  return false;
}
