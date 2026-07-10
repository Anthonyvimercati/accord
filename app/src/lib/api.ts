/**
 * Enveloppes typées des méthodes de l'API locale (contrat API.md).
 * Les identifiants transitent en hexadécimal ; les corps de messages
 * arrivent déjà décodés en JSON structuré.
 */

import type { RpcClient } from './rpc';

export interface SelfProfile {
  node_id: string;
  pubkey: string;
  friend_code: string;
  /** Pseudo choisi par l'utilisateur (`null` tant qu'aucun n'est défini). */
  name: string | null;
  /** Bio locale (`null` tant qu'aucune n'est définie). */
  bio: string | null;
  /** Racine Merkle de l'avatar (hex 64), ou `null` sans avatar. */
  avatar: string | null;
  /** Racine Merkle de la bannière de profil (hex 64), ou `null` sans bannière. */
  banner: string | null;
}

export type ContactState = 'pending_out' | 'pending_in' | 'friend' | 'blocked';

export interface Contact {
  node_id: string;
  pubkey: string;
  friend_code: string;
  display_name: string;
  /** Bio annoncée par le pair (`null` si inconnue ou effacée). */
  bio: string | null;
  /** Racine Merkle de l'avatar annoncé (hex 64), ou `null` sans avatar. */
  avatar: string | null;
  /** Racine Merkle de la bannière annoncée (hex 64), ou `null` sans bannière. */
  banner: string | null;
  state: ContactState;
  last_seen_ms: number;
  /** Présence best-effort du pair (`friends.list`, D-027) ; absente = inconnue. */
  online?: boolean;
  /** Messages du pair reçus après notre `dm.mark_read` ; absent = inconnu. */
  unread?: number;
}

/** Référence de pièce jointe (enveloppe des messages et `files.*`). */
export interface FileAttachment {
  merkle_root: string;
  name: string;
  size: number;
  mime: string;
}

export type MsgBody =
  | { type: 'text'; text: string; reply_to: string | null; attachments: number }
  | { type: 'edit'; target: string; text: string }
  | { type: 'delete'; target: string }
  | { type: 'reaction'; target: string; emoji: string; add: boolean }
  | { type: 'meta' }
  | { type: 'unknown' };

/** Réaction emoji : une entrée par paire emoji × auteur (API.md). */
export interface Reaction {
  emoji: string;
  author: string;
}

export interface DmMessage {
  msg_id: string;
  author: string;
  lamport: number;
  sent_ms: number;
  acked: boolean;
  deleted: boolean;
  body: MsgBody;
  edited: string | null;
  /** Toujours émis par le nœud (`[]` si aucune) ; optionnel par tolérance. */
  reactions?: Reaction[];
  /** Pièces jointes de l'enveloppe (toujours émises, `[]` si aucune). */
  attachments?: FileAttachment[];
}

export interface GroupMessage {
  msg_id: string;
  channel_id: string;
  author: string;
  lamport: number;
  sent_ms: number;
  deleted: boolean;
  body: MsgBody;
  edited: string | null;
  /** Toujours émis par le nœud (vide pour l'instant côté groupes, D-022). */
  reactions?: Reaction[];
  /** Pièces jointes de l'enveloppe (toujours émises, `[]` si aucune). */
  attachments?: FileAttachment[];
}

/** Genre d'un salon (API.md §Groupes : `kind`, défaut `"text"`). */
export type GroupChannelKind = 'text' | 'voice' | 'announcement';

export interface GroupChannel {
  channel_id: string;
  name: string;
  kind: GroupChannelKind;
  /** Catégorie d'appartenance (hex), ou `null` hors catégorie. */
  category: string | null;
  position: number;
  topic: string;
}

export interface GroupCategory {
  category_id: string;
  name: string;
  position: number;
}

export interface GroupRole {
  role_id: string;
  name: string;
  /** Couleur RGB (`0xRRGGBB`) ; `0` = aucune couleur. */
  color: number;
  position: number;
  /** Bitfield de permissions (voir `PERMISSIONS` dans stores/groups). */
  permissions: number;
}

/** Membre d'un groupe et ses rôles (identifiants de rôles). */
export interface GroupMember {
  pubkey: string;
  roles: string[];
}

export interface GroupInvite {
  invite_id: string;
  max_uses: number;
  uses: number;
  expires_ms: number;
  revoked: boolean;
}

/** Émoji de serveur : nom (`[a-z0-9_]`) et racine Merkle de son image. */
export interface ServerEmoji {
  name: string;
  merkle_root: string;
}

export interface GroupStateJson {
  group_id: string;
  name: string;
  /** Racine Merkle de l'icône (hex 64), ou `null` sans icône. */
  icon: string | null;
  founder: string | null;
  members: GroupMember[];
  bans: string[];
  channels: GroupChannel[];
  categories: GroupCategory[];
  roles: GroupRole[];
  invites: GroupInvite[];
  /** Émojis de serveur, ordre stable lexicographique par `name` (peut manquer). */
  emojis?: ServerEmoji[];
  /** Bitfield global de permissions de l'identité locale. */
  my_permissions: number;
}

/**
 * Résultat de `files.read` : octets en base64 si le blob est complet en
 * local, `{ pending: true }` sinon (le téléchargement vient d'être lancé).
 */
export type FilesReadResult =
  | { pending: true }
  | { data_b64: string; name: string; mime: string; size: number; pending?: undefined };

/**
 * Résultat de `files.status` : progression en blocs de 256 Kio ; `name`,
 * `size` et `mime` ne sont présents que si le manifeste est connu.
 */
export interface FilesStatusResult {
  known: boolean;
  complete: boolean;
  done: number;
  total: number;
  name?: string;
  size?: number;
  mime?: string;
}

/** Participant d'un salon vocal avec son état de parole (voice.status). */
export interface VoiceParticipant {
  pubkey: string;
  speaking: boolean;
}

/** Salon vocal actif tel que rendu par voice.status (`null` si aucun). */
export interface VoiceActive {
  group_id: string;
  channel_id: string;
  muted: boolean;
  participants: VoiceParticipant[];
}

/**
 * Périphériques audio (voice.devices) : noms cpal, `null` = périphérique par
 * défaut du système. Listes vides et sélections nulles en mode simulé.
 */
export interface VoiceDevices {
  inputs: string[];
  outputs: string[];
  selected_input: string | null;
  selected_output: string | null;
}

/** Sélection de périphériques à appliquer (champ absent = inchangé). */
export interface VoiceDeviceSelection {
  input?: string | null;
  output?: string | null;
}

/** État du réseau P2P (voir `network.status`). */
export interface NetworkStatus {
  /** Port UDP local effectivement lié. */
  p2p_port: number;
  /** Adresses `ip:port` joignables (à communiquer à un ami) ; la première est
   * l'adresse publique observée si connue. */
  local_addrs: string[];
  /** Pairs d'amorçage enregistrés (`ip:port`). */
  bootstrap: string[];
  /** Nombre de pairs actuellement connectés. */
  connected_peers: number;
  /** Nombre de nœuds connus dans la table de routage DHT. */
  dht_nodes: number;
  /** Adresse externe (`ip:port` publique) ouverte par le mapping de port
   * automatique, ou `null` si aucun mapping n'est actif. */
  external_addr: string | null;
  /** Méthode de mapping de port active : `'upnp'`, `'natpmp'` ou `'aucun'`. */
  port_mapping: 'upnp' | 'natpmp' | 'aucun';
  /** Nombre de pairs Accord découverts sur le réseau local (mDNS). */
  lan_peers: number;
}

/** Événements poussés par le nœud (API.md §Événements). */
export type AccordEvent =
  | {
      method: 'event.dm';
      params: { peer: string; msg_id: string; attachments: FileAttachment[] };
    }
  | { method: 'event.dm_typing'; params: { peer: string } }
  | { method: 'event.friend_request'; params: { peer: string } }
  | { method: 'event.friend_response'; params: { peer: string; accepted: boolean } }
  | { method: 'event.group_op'; params: { group_id: string } }
  | { method: 'event.group_state'; params: { group_id: string } }
  | {
      method: 'event.group_msg';
      params: {
        group_id: string;
        channel_id: string;
        msg_id: string;
        attachments: FileAttachment[];
      };
    }
  | { method: 'event.group_key'; params: { group_id: string } }
  | {
      method: 'event.group_typing';
      params: { group_id: string; channel_id: string; pubkey: string };
    }
  | {
      method: 'event.voice_joined';
      params: { group_id: string; channel_id: string; pubkey: string };
    }
  | {
      method: 'event.voice_left';
      params: { group_id: string; channel_id: string; pubkey: string };
    }
  | { method: 'event.voice_speaking'; params: { pubkey: string; speaking: boolean } }
  | { method: 'event.voice_level'; params: { level: number; speaking: boolean } }
  | {
      method: 'event.profile';
      params: {
        pubkey: string;
        name: string;
        bio: string | null;
        avatar: string | null;
        banner: string | null;
      };
    }
  | { method: 'event.presence'; params: { pubkey: string; online: boolean } }
  | {
      method: 'event.network';
      params: { connected_peers: number; dht_nodes: number };
    }
  | {
      method: 'event.file_progress';
      params: { merkle_root: string; done: number; total: number; complete: boolean };
    }
  | { method: 'event.desynchronise'; params: Record<string, never> };

export class Api {
  constructor(private readonly rpc: RpcClient) {}

  identitySelf(): Promise<SelfProfile> {
    return this.rpc.call('identity.self');
  }

  /** Profil local (`null` pour chaque champ jamais défini). */
  profileGet(): Promise<{
    name: string | null;
    bio: string | null;
    avatar: string | null;
    banner: string | null;
  }> {
    return this.rpc.call('profile.get');
  }

  /**
   * Définit le pseudo (2 à 32 caractères) et/ou la bio (≤ 2048 caractères,
   * chaîne vide = effacer) — au moins un des deux champs requis, tout ou rien.
   */
  profileSet(changes: { name?: string; bio?: string }): Promise<Record<string, never>> {
    return this.rpc.call('profile.set', {
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.bio !== undefined ? { bio: changes.bio } : {}),
    });
  }

  /**
   * Publie l'avatar (image/png|jpeg|webp, ≤ 512 Kio décodés) et rend le hash
   * du blob ; `dataB64: null` retire l'avatar (rend `{ avatar: null }`).
   */
  profileSetAvatar(
    dataB64: string | null,
    mime?: string,
  ): Promise<{ avatar: string | null }> {
    return this.rpc.call('profile.set_avatar', {
      data_b64: dataB64,
      ...(mime !== undefined ? { mime } : {}),
    });
  }

  /**
   * Publie la bannière de profil (image paysage, mêmes formats/limites que
   * l'avatar) et rend le hash du blob ; `dataB64: null` retire la bannière
   * (rend `{ banner: null }`).
   */
  profileSetBanner(
    dataB64: string | null,
    mime?: string,
  ): Promise<{ banner: string | null }> {
    return this.rpc.call('profile.set_banner', {
      data_b64: dataB64,
      ...(mime !== undefined ? { mime } : {}),
    });
  }

  friendsList(): Promise<{ contacts: Contact[] }> {
    return this.rpc.call('friends.list');
  }

  friendsResolve(friendCode: string): Promise<{ pubkey: string }> {
    return this.rpc.call('friends.resolve', { friend_code: friendCode });
  }

  friendsRequest(pubkey: string, displayName: string): Promise<{ ok: true }> {
    return this.rpc.call('friends.request', { pubkey, display_name: displayName });
  }

  friendsRespond(pubkey: string, accept: boolean): Promise<{ ok: true }> {
    return this.rpc.call('friends.respond', { pubkey, accept });
  }

  friendsBlock(pubkey: string): Promise<{ ok: true }> {
    return this.rpc.call('friends.block', { pubkey });
  }

  friendsUnblock(pubkey: string): Promise<{ ok: true }> {
    return this.rpc.call('friends.unblock', { pubkey });
  }

  /**
   * Envoie un message direct, éventuellement avec des pièces jointes déjà
   * publiées (`files.share_bytes`) — texte vide admis si au moins une pièce.
   */
  dmSend(
    pubkey: string,
    text: string,
    replyTo?: string,
    attachments?: FileAttachment[],
  ): Promise<{ msg_id: string }> {
    return this.rpc.call('dm.send', {
      pubkey,
      text,
      ...(replyTo !== undefined ? { reply_to: replyTo } : {}),
      ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
    });
  }

  dmHistory(pubkey: string, limit = 50): Promise<{ messages: DmMessage[] }> {
    return this.rpc.call('dm.history', { pubkey, limit });
  }

  /** Modifie un de ses propres messages (le nœud refuse sinon). */
  dmEdit(pubkey: string, msgId: string, text: string): Promise<{ ok: true }> {
    return this.rpc.call('dm.edit', { pubkey, msg_id: msgId, text });
  }

  /** Supprime un de ses propres messages (tombstone local immédiat). */
  dmDelete(pubkey: string, msgId: string): Promise<{ ok: true }> {
    return this.rpc.call('dm.delete', { pubkey, msg_id: msgId });
  }

  /** Ajoute (ou retire avec `remove`) une réaction emoji à un message. */
  dmReact(
    pubkey: string,
    msgId: string,
    emoji: string,
    remove = false,
  ): Promise<{ ok: true }> {
    return this.rpc.call('dm.react', {
      pubkey,
      msg_id: msgId,
      emoji,
      ...(remove ? { remove: true } : {}),
    });
  }

  /**
   * Signale au pair qu'on est en train d'écrire — indicateur éphémère,
   * jamais persisté (pair hors ligne : silencieusement ignoré par le nœud).
   */
  dmTyping(pubkey: string): Promise<{ ok: true }> {
    return this.rpc.call('dm.typing', { pubkey });
  }

  /**
   * Enregistre la position de lecture de la conversation (lamport du dernier
   * message affiché) — alimente `unread` dans `friends.list`.
   */
  dmMarkRead(pubkey: string, lamport: number): Promise<{ ok: true }> {
    return this.rpc.call('dm.mark_read', { pubkey, lamport });
  }

  groupsCreate(name: string): Promise<{ group_id: string }> {
    return this.rpc.call('groups.create', { name });
  }

  /**
   * Liste des groupes et non-lus par salon (`{ group_id: { channel_id: n } }`,
   * seuls les salons ayant au moins un non-lu figurent) — `unread` optionnel
   * par tolérance.
   */
  groupsList(): Promise<{
    groups: string[];
    unread?: Record<string, Record<string, number>>;
  }> {
    return this.rpc.call('groups.list');
  }

  /**
   * Signale aux membres en ligne qu'on écrit dans le salon — indicateur
   * éphémère, jamais persisté ni mis en file.
   */
  groupsTyping(groupId: string, channelId: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.typing', {
      group_id: groupId,
      channel_id: channelId,
    });
  }

  /**
   * Enregistre la position de lecture du salon (lamport du dernier message
   * affiché) — alimente `unread` dans `groups.list`.
   */
  groupsMarkRead(
    groupId: string,
    channelId: string,
    lamport: number,
  ): Promise<{ ok: true }> {
    return this.rpc.call('groups.mark_read', {
      group_id: groupId,
      channel_id: channelId,
      lamport,
    });
  }

  groupsState(groupId: string): Promise<GroupStateJson> {
    return this.rpc.call('groups.state', { group_id: groupId });
  }

  /** Renomme le groupe (1 à 100 caractères, le nœud refuse sinon). */
  groupsRename(groupId: string, name: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.rename', { group_id: groupId, name });
  }

  /**
   * Publie l'icône du groupe (image ≤ 512 Kio décodés) et rend sa racine
   * Merkle ; les octets se relisent ensuite via `files.read`.
   */
  groupsSetIcon(
    groupId: string,
    dataB64: string,
    mime: string,
  ): Promise<{ icon: string }> {
    return this.rpc.call('groups.set_icon', {
      group_id: groupId,
      data_b64: dataB64,
      mime,
    });
  }

  /** Définit le sujet d'un salon (≤ 2048 octets ; chaîne vide = effacer). */
  groupsSetTopic(
    groupId: string,
    channelId: string,
    topic: string,
  ): Promise<{ ok: true }> {
    return this.rpc.call('groups.set_topic', {
      group_id: groupId,
      channel_id: channelId,
      topic,
    });
  }

  groupsChannelAdd(
    groupId: string,
    name: string,
    kind?: GroupChannelKind,
    category?: string,
  ): Promise<{ channel_id: string }> {
    return this.rpc.call('groups.channel.add', {
      group_id: groupId,
      name,
      ...(kind !== undefined ? { kind } : {}),
      ...(category !== undefined ? { category } : {}),
    });
  }

  /** Modifie un salon (champ absent = inchangé). */
  groupsChannelEdit(
    groupId: string,
    channelId: string,
    changes: { name?: string; position?: number },
  ): Promise<{ ok: true }> {
    return this.rpc.call('groups.channel.edit', {
      group_id: groupId,
      channel_id: channelId,
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.position !== undefined ? { position: changes.position } : {}),
    });
  }

  groupsChannelDel(groupId: string, channelId: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.channel.del', {
      group_id: groupId,
      channel_id: channelId,
    });
  }

  groupsCategoryAdd(groupId: string, name: string): Promise<{ category_id: string }> {
    return this.rpc.call('groups.category.add', { group_id: groupId, name });
  }

  /** Expulse un membre (hiérarchie vérifiée par le nœud). */
  groupsKick(groupId: string, pubkey: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.kick', { group_id: groupId, pubkey });
  }

  /** Bannit un membre : il ne peut plus être (ré)admis. */
  groupsBan(groupId: string, pubkey: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.ban', { group_id: groupId, pubkey });
  }

  groupsUnban(groupId: string, pubkey: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.unban', { group_id: groupId, pubkey });
  }

  /** Quitte le groupe (refusé au fondateur tant qu'il reste des membres). */
  groupsLeave(groupId: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.leave', { group_id: groupId });
  }

  groupsRoleAdd(
    groupId: string,
    name: string,
    color: number,
    permissions: number,
  ): Promise<{ role_id: string }> {
    return this.rpc.call('groups.role.add', {
      group_id: groupId,
      name,
      color,
      permissions,
    });
  }

  /** Modifie un rôle (champ absent = inchangé). */
  groupsRoleEdit(
    groupId: string,
    roleId: string,
    changes: { name?: string; color?: number; position?: number; permissions?: number },
  ): Promise<{ ok: true }> {
    return this.rpc.call('groups.role.edit', {
      group_id: groupId,
      role_id: roleId,
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.color !== undefined ? { color: changes.color } : {}),
      ...(changes.position !== undefined ? { position: changes.position } : {}),
      ...(changes.permissions !== undefined ? { permissions: changes.permissions } : {}),
    });
  }

  groupsRoleDel(groupId: string, roleId: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.role.del', { group_id: groupId, role_id: roleId });
  }

  groupsRoleAssign(
    groupId: string,
    roleId: string,
    pubkey: string,
  ): Promise<{ ok: true }> {
    return this.rpc.call('groups.role.assign', {
      group_id: groupId,
      role_id: roleId,
      pubkey,
    });
  }

  groupsRoleUnassign(
    groupId: string,
    roleId: string,
    pubkey: string,
  ): Promise<{ ok: true }> {
    return this.rpc.call('groups.role.unassign', {
      group_id: groupId,
      role_id: roleId,
      pubkey,
    });
  }

  /** Épingle un message connu localement (`MANAGE_MESSAGES` requis). */
  groupsPin(groupId: string, channelId: string, msgId: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.pin', {
      group_id: groupId,
      channel_id: channelId,
      msg_id: msgId,
    });
  }

  groupsUnpin(groupId: string, channelId: string, msgId: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.unpin', {
      group_id: groupId,
      channel_id: channelId,
      msg_id: msgId,
    });
  }

  groupsPins(groupId: string, channelId: string): Promise<{ msg_ids: string[] }> {
    return this.rpc.call('groups.pins', {
      group_id: groupId,
      channel_id: channelId,
    });
  }

  /** Modifie un de ses propres messages de salon (le nœud refuse sinon). */
  groupsEdit(
    groupId: string,
    channelId: string,
    msgId: string,
    text: string,
  ): Promise<{ ok: true }> {
    return this.rpc.call('groups.edit', {
      group_id: groupId,
      channel_id: channelId,
      msg_id: msgId,
      text,
    });
  }

  /**
   * Supprime un message de salon : le sien (tombstone diffusée) ou celui
   * d'autrui (op de modération, `MANAGE_MESSAGES` requis).
   */
  groupsDelete(groupId: string, channelId: string, msgId: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.delete', {
      group_id: groupId,
      channel_id: channelId,
      msg_id: msgId,
    });
  }

  /** Ajoute (`add: true`) ou retire une réaction emoji sur un message. */
  groupsReact(
    groupId: string,
    channelId: string,
    msgId: string,
    emoji: string,
    add: boolean,
  ): Promise<{ ok: true }> {
    return this.rpc.call('groups.react', {
      group_id: groupId,
      channel_id: channelId,
      msg_id: msgId,
      emoji,
      add,
    });
  }

  /**
   * Lit un fichier du magasin local par sa racine Merkle (borné à 8 Mio).
   * `hint` : clé publique d'un pair source probable pour le téléchargement.
   */
  filesRead(merkleRoot: string, hint?: string): Promise<FilesReadResult> {
    return this.rpc.call('files.read', {
      merkle_root: merkleRoot,
      ...(hint !== undefined ? { hint } : {}),
    });
  }

  /**
   * Publie des octets fournis par l'UI dans le magasin local (base64
   * standard, borné à 8 Mio décodés) et rend la référence de pièce jointe.
   */
  filesShareBytes(
    name: string,
    mime: string,
    dataB64: string,
  ): Promise<{ file: FileAttachment }> {
    return this.rpc.call('files.share_bytes', { name, mime, data_b64: dataB64 });
  }

  /** État local d'un fichier (manifeste connu, progression en blocs). */
  filesStatus(merkleRoot: string, hint?: string): Promise<FilesStatusResult> {
    return this.rpc.call('files.status', {
      merkle_root: merkleRoot,
      ...(hint !== undefined ? { hint } : {}),
    });
  }

  groupsHistory(
    groupId: string,
    channelId: string,
    limit = 50,
  ): Promise<{ messages: GroupMessage[] }> {
    return this.rpc.call('groups.history', {
      group_id: groupId,
      channel_id: channelId,
      limit,
    });
  }

  /**
   * Envoie un message de salon, éventuellement en réponse à `replyTo` (msg_id,
   * hex 32) et avec des pièces jointes déjà publiées (texte vide admis).
   */
  groupsSend(
    groupId: string,
    channelId: string,
    text: string,
    replyTo?: string,
    attachments?: FileAttachment[],
  ): Promise<{ msg_id: string }> {
    return this.rpc.call('groups.send', {
      group_id: groupId,
      channel_id: channelId,
      text,
      ...(replyTo !== undefined ? { reply_to: replyTo } : {}),
      ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
    });
  }

  groupsInvite(groupId: string, pubkey: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.invite', { group_id: groupId, pubkey });
  }

  /**
   * Ajoute (ou remplace) un émoji de serveur (`MANAGE_EMOJIS`) : nom
   * `[a-z0-9_]` 2-32, image ≤ 256 Kio décodés (png/jpeg/webp/gif). Rend la
   * racine Merkle de l'image publiée.
   */
  groupsEmojiAdd(
    groupId: string,
    name: string,
    dataB64: string,
    mime: string,
  ): Promise<{ merkle_root: string }> {
    return this.rpc.call('groups.emoji.add', {
      group_id: groupId,
      name,
      data_b64: dataB64,
      mime,
    });
  }

  /** Supprime un émoji de serveur par son nom (`MANAGE_EMOJIS`). */
  groupsEmojiDel(groupId: string, name: string): Promise<{ ok: true }> {
    return this.rpc.call('groups.emoji.del', { group_id: groupId, name });
  }

  searchQuery(query: string): Promise<{ msg_ids: string[] }> {
    return this.rpc.call('search.query', { query });
  }

  /**
   * Rejoint un salon vocal (quitte l'ancien implicitement : un seul salon
   * actif à la fois). Le nœud refuse au-delà de 10 participants (full mesh).
   */
  voiceJoin(groupId: string, channelId: string): Promise<{ participants: string[] }> {
    return this.rpc.call('voice.join', { group_id: groupId, channel_id: channelId });
  }

  /** Quitte le salon vocal actif. */
  voiceLeave(): Promise<Record<string, never>> {
    return this.rpc.call('voice.leave');
  }

  /** Coupe ou rétablit la capture micro locale ; on reste dans le salon. */
  voiceMute(muted: boolean): Promise<Record<string, never>> {
    return this.rpc.call('voice.mute', { muted });
  }

  /** État vocal courant (`active: null` hors salon), pour resynchronisation. */
  voiceStatus(): Promise<{ active: VoiceActive | null }> {
    return this.rpc.call('voice.status');
  }

  /** Périphériques audio disponibles et sélection courante. */
  voiceDevices(): Promise<VoiceDevices> {
    return this.rpc.call('voice.devices');
  }

  /**
   * Applique une sélection de périphériques (persistée ; à chaud si un salon
   * vocal est actif). `null` = périphérique par défaut ; nom inconnu = erreur.
   */
  voiceSetDevices(selection: VoiceDeviceSelection): Promise<Record<string, never>> {
    const params: Record<string, unknown> = {};
    if (selection.input !== undefined) params.input = selection.input;
    if (selection.output !== undefined) params.output = selection.output;
    return this.rpc.call('voice.set_devices', params);
  }

  /**
   * Démarre/arrête le test du micro : pendant l'activation, le nœud pousse
   * `event.voice_level` (~10 Hz) depuis la capture réelle. Erreur explicite
   * si le backend matériel n'est pas disponible.
   */
  voiceMicTest(enabled: boolean): Promise<Record<string, never>> {
    return this.rpc.call('voice.mic_test', { enabled });
  }

  /**
   * État du réseau : port P2P local, adresses joignables (à communiquer à un
   * ami), pairs d'amorçage enregistrés, et compteurs de connexions/nœuds DHT.
   */
  networkStatus(): Promise<NetworkStatus> {
    return this.rpc.call('network.status');
  }

  /**
   * Ajoute un pair d'amorçage par son adresse `ip:port` (validation et
   * connexion immédiates) ; rend l'état réseau à jour.
   */
  networkAddPeer(addr: string): Promise<NetworkStatus> {
    return this.rpc.call('network.add_peer', { addr });
  }

  /** Retire un pair d'amorçage ; rend l'état réseau à jour. */
  networkRemovePeer(addr: string): Promise<NetworkStatus> {
    return this.rpc.call('network.remove_peer', { addr });
  }
}
