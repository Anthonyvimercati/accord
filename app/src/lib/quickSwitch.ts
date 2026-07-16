/**
 * Sélecteur rapide (Ctrl/Cmd+K) et raccourcis de navigation : logique pure
 * (construction des destinations, classement flou, dernières destinations,
 * cycle de salon/conversation) — aucun accès React/DOM, testable en isolation.
 * Le rendu vit dans `components/QuickSwitcher.tsx`, câblé dans `AppShell`.
 */

import type { Contact, GroupChannel, GroupChannelKind, GroupStateJson } from './api';
import { channelsByCategory, isChannelVisible } from '../stores/groups';
import type { View } from '../stores/ui';

/** Identifiant stable d'un résultat « conversation privée ». */
export function dmItemId(pubkey: string): string {
  return `dm:${pubkey}`;
}

/** Identifiant stable d'un résultat « salon de serveur ». */
export function channelItemId(groupId: string, channelId: string): string {
  return `channel:${groupId}/${channelId}`;
}

/** Identifiant stable d'un résultat « serveur ». */
export function serverItemId(groupId: string): string {
  return `server:${groupId}`;
}

interface QuickSwitchItemBase {
  /** Clé stable, unique dans la liste des résultats (voir `dmItemId`/`channelItemId`). */
  id: string;
  /** Texte comparé à la requête (`matchScore`) et affiché comme libellé principal. */
  label: string;
  view: View;
}

/** Entrée spéciale « Amis / Accueil », toujours proposée en tête des sources. */
export interface FriendsSwitchItem extends QuickSwitchItemBase {
  kind: 'friends';
}

/** Conversation privée avec un ami établi. */
export interface DmSwitchItem extends QuickSwitchItemBase {
  kind: 'dm';
  pubkey: string;
  avatarHash: string | null;
  avatarDecoration: string | null;
}

/** Salon (texte, annonces ou vocal) d'un serveur rejoint et visible localement. */
export interface ChannelSwitchItem extends QuickSwitchItemBase {
  kind: 'channel';
  /** Nom du serveur — affiché en sous-titre. */
  subtitle: string;
  channelKind: GroupChannelKind;
  groupId: string;
  channelId: string;
}

/**
 * Serveur rejoint. Pas de `view` figée : la destination (dernier salon
 * consulté) est résolue à la sélection, comme un clic sur l'icône du rail
 * (`ServerRail.channelToRestore`).
 */
export interface ServerSwitchItem {
  id: string;
  kind: 'server';
  label: string;
  groupId: string;
}

export type QuickSwitchItem =
  FriendsSwitchItem | DmSwitchItem | ChannelSwitchItem | ServerSwitchItem;

/**
 * Construit l'ensemble des destinations proposées par le sélecteur : la vue
 * Amis, les conversations privées établies, chaque serveur rejoint et les
 * salons (tous genres) que
 * l'utilisateur local peut voir dans chaque serveur rejoint. `isChannelVisible`
 * reproduit ici le même filtre que la barre latérale (`Sidebar.GroupSidebar`).
 */
export function buildQuickSwitchItems(params: {
  friendsLabel: string;
  contacts: readonly Contact[];
  groupIds: readonly string[];
  groupStates: Readonly<Record<string, GroupStateJson>>;
  selfPubkey: string | null;
}): QuickSwitchItem[] {
  const items: QuickSwitchItem[] = [
    {
      id: 'friends',
      kind: 'friends',
      label: params.friendsLabel,
      view: { kind: 'friends' },
    },
  ];

  for (const contact of params.contacts) {
    if (contact.state !== 'friend') continue;
    items.push({
      id: dmItemId(contact.pubkey),
      kind: 'dm',
      label:
        contact.display_name.trim() !== '' ? contact.display_name : contact.friend_code,
      pubkey: contact.pubkey,
      avatarHash: contact.avatar,
      avatarDecoration: contact.avatar_decoration ?? null,
      view: { kind: 'dm', peer: contact.pubkey },
    });
  }

  for (const groupId of params.groupIds) {
    const state = params.groupStates[groupId];
    if (state === undefined) continue;
    items.push({ id: serverItemId(groupId), kind: 'server', label: state.name, groupId });
    for (const channel of state.channels) {
      if (!isChannelVisible(state, channel.channel_id, params.selfPubkey)) continue;
      items.push({
        id: channelItemId(groupId, channel.channel_id),
        kind: 'channel',
        label: channel.name,
        subtitle: state.name,
        channelKind: channel.kind,
        groupId,
        channelId: channel.channel_id,
        view: { kind: 'group', groupId, channelId: channel.channel_id },
      });
    }
  }

  return items;
}

/**
 * Destinations récentes affichées quand la requête est vide : la dernière
 * conversation privée ouverte, puis le dernier salon consulté de chaque
 * serveur (ordre du rail), dérivées de la mémoire de navigation existante
 * (`lib/navPersistence`, reflétée dans `stores/ui`) — aucune liste d'historique
 * séparée à maintenir.
 */
export function buildRecentItems(
  items: readonly QuickSwitchItem[],
  groupIds: readonly string[],
  lastChannelByServer: Readonly<Record<string, string>>,
  lastDmPeer: string | null,
): QuickSwitchItem[] {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const recent: QuickSwitchItem[] = [];

  if (lastDmPeer !== null) {
    const dm = byId.get(dmItemId(lastDmPeer));
    if (dm !== undefined) recent.push(dm);
  }
  for (const groupId of groupIds) {
    const channelId = lastChannelByServer[groupId];
    if (channelId === undefined) continue;
    const channel = byId.get(channelItemId(groupId, channelId));
    if (channel !== undefined) recent.push(channel);
  }
  return recent;
}

/* ------------------------------------------------------------------ */
/* Classement flou.                                                    */
/* ------------------------------------------------------------------ */

const SCORE_SUBSEQUENCE = 1;
const SCORE_SUBSTRING = 2;
const SCORE_WORD_BOUNDARY = 3;
const SCORE_PREFIX = 4;

/** Découpe un texte en mots (frontières non alphanumériques, accents compris). */
function splitWords(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '');
}

/** Vrai si les caractères de `query` apparaissent dans `text`, dans l'ordre. */
function isSubsequence(query: string, text: string): boolean {
  let i = 0;
  for (const ch of text) {
    if (i >= query.length) break;
    if (ch === query[i]) i += 1;
  }
  return i === query.length;
}

/**
 * Score de correspondance flou, sans dépendance externe : préfixe > limite de
 * mot > sous-chaîne > sous-séquence (caractères dans l'ordre, pas forcément
 * contigus). `null` si `query` ne correspond pas du tout, ou est vide.
 */
export function matchScore(label: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === '') return null;
  const text = label.toLowerCase();
  if (text.startsWith(q)) return SCORE_PREFIX;
  if (splitWords(text).some((word) => word.startsWith(q))) return SCORE_WORD_BOUNDARY;
  if (text.includes(q)) return SCORE_SUBSTRING;
  if (isSubsequence(q, text)) return SCORE_SUBSEQUENCE;
  return null;
}

/**
 * Filtre puis classe `items` par pertinence décroissante vis-à-vis de `query`
 * (`matchScore`), départagé par ordre alphabétique du libellé. Générique sur
 * `{ label }` pour rester testable sans construire de `QuickSwitchItem` complet.
 */
export function rankQuickSwitchItems<T extends { label: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const score = matchScore(item.label, query);
    if (score !== null) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return scored.map((s) => s.item);
}

/* ------------------------------------------------------------------ */
/* Cycle de salon/conversation (Alt+↑/↓).                              */
/* ------------------------------------------------------------------ */

/**
 * Salons visibles d'un serveur, dans l'ordre affiché par la barre latérale
 * (sans catégorie d'abord, puis catégories par position) — même filtre de
 * visibilité que `Sidebar.GroupSidebar` (`isChannelVisible`).
 */
export function visibleNavigableChannels(
  state: Pick<
    GroupStateJson,
    'channels' | 'categories' | 'my_permissions' | 'members' | 'overrides'
  >,
  selfPubkey: string | null,
): GroupChannel[] {
  const visible = state.channels.filter((c) =>
    isChannelVisible(state, c.channel_id, selfPubkey),
  );
  return channelsByCategory(visible, state.categories).flatMap(
    (section) => section.channels,
  );
}

/**
 * Salon suivant (`direction = 1`) ou précédent (`-1`) dans `channels`
 * (déjà filtrés/ordonnés, voir `visibleNavigableChannels`), salons vocaux
 * ignorés, avec bouclage. `null` sans salon navigable. Sans salon actif
 * connu (`currentChannelId` absent de la liste), démarre au premier
 * (`direction = 1`) ou dernier (`-1`).
 */
export function cycleChannel(
  channels: readonly GroupChannel[],
  currentChannelId: string | null,
  direction: 1 | -1,
): string | null {
  const navigable = channels.filter((c) => c.kind !== 'voice');
  if (navigable.length === 0) return null;
  const index = navigable.findIndex((c) => c.channel_id === currentChannelId);
  if (index === -1) {
    return direction === 1
      ? navigable[0]!.channel_id
      : navigable[navigable.length - 1]!.channel_id;
  }
  const nextIndex = (index + direction + navigable.length) % navigable.length;
  return navigable[nextIndex]!.channel_id;
}

/** Même sémantique que `cycleChannel`, pour la liste des pairs en MP (vue Accueil). */
export function cycleDm(
  peers: readonly string[],
  currentPeer: string | null,
  direction: 1 | -1,
): string | null {
  if (peers.length === 0) return null;
  const index = peers.findIndex((p) => p === currentPeer);
  if (index === -1) return direction === 1 ? peers[0]! : peers[peers.length - 1]!;
  const nextIndex = (index + direction + peers.length) % peers.length;
  return peers[nextIndex]!;
}

/* ------------------------------------------------------------------ */
/* Affichage des raccourcis (plateforme).                              */
/* ------------------------------------------------------------------ */

/** Vrai si `platform` désigne macOS (repli : `navigator.platform` courant). */
export function isMacPlatform(platform: string = navigator.platform): boolean {
  return /mac/i.test(platform);
}
