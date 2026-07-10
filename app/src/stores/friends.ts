/** Contacts : liste, ajout par code ami, réponses, blocage, profils amis. */

import { create } from 'zustand';
import { api } from '../lib/client';
import type { Contact } from '../lib/api';

/** Charge utile d'`event.profile` : profil annoncé par un ami. */
export interface ProfilAmi {
  pubkey: string;
  name: string;
  bio: string | null;
  avatar: string | null;
  banner: string | null;
}

interface FriendsState {
  contacts: Contact[];
  loaded: boolean;
  load: () => Promise<void>;
  addByCode: (code: string, myDisplayName: string) => Promise<void>;
  respond: (pubkey: string, accept: boolean) => Promise<void>;
  /**
   * Marque la conversation lue jusqu'à `lamport` (dernier message affiché)
   * puis recharge la liste pour faire tomber le compteur `unread`.
   */
  markRead: (pubkey: string, lamport: number) => Promise<void>;
  block: (pubkey: string) => Promise<void>;
  unblock: (pubkey: string) => Promise<void>;
  /**
   * Applique un profil annoncé (`event.profile`) au contact correspondant —
   * pseudo, bio, avatar et bannière remplacent les valeurs connues
   * (`null` = effacé). Contact inconnu : ignoré (le nœud n'annonce que des amis).
   */
  applyProfile: (profil: ProfilAmi) => void;
  /** Reflète un changement de présence (`event.presence`) d'un ami. */
  applyPresence: (pubkey: string, online: boolean) => void;
}

export const useFriends = create<FriendsState>((set, get) => ({
  contacts: [],
  loaded: false,

  load: async () => {
    const { contacts } = await api.friendsList();
    set({ contacts, loaded: true });
  },

  addByCode: async (code, myDisplayName) => {
    const { pubkey } = await api.friendsResolve(code.trim());
    await api.friendsRequest(pubkey, myDisplayName);
    await get().load();
  },

  respond: async (pubkey, accept) => {
    await api.friendsRespond(pubkey, accept);
    await get().load();
  },

  markRead: async (pubkey, lamport) => {
    await api.dmMarkRead(pubkey, lamport);
    await get().load();
  },

  block: async (pubkey) => {
    await api.friendsBlock(pubkey);
    await get().load();
  },

  unblock: async (pubkey) => {
    await api.friendsUnblock(pubkey);
    await get().load();
  },

  applyProfile: (profil) => {
    set((s) => ({
      contacts: s.contacts.map((c) =>
        c.pubkey === profil.pubkey
          ? {
              ...c,
              display_name: profil.name,
              bio: profil.bio,
              avatar: profil.avatar,
              banner: profil.banner,
            }
          : c,
      ),
    }));
  },

  applyPresence: (pubkey, online) => {
    set((s) => ({
      contacts: s.contacts.map((c) => (c.pubkey === pubkey ? { ...c, online } : c)),
    }));
  },
}));

/** Nom affichable d'un pair : contact connu, sinon identifiant court. */
export function displayNameOf(contacts: Contact[], pubkey: string): string {
  const contact = contacts.find((c) => c.pubkey === pubkey);
  if (contact && contact.display_name.trim() !== '') return contact.display_name;
  return pubkey.slice(0, 6);
}

/**
 * Hash d'avatar d'un pair : celui du contact connu, sinon `null` (les
 * avatars des non-amis ne circulent pas — limite connue du protocole).
 */
export function avatarOf(contacts: Contact[], pubkey: string): string | null {
  return contacts.find((c) => c.pubkey === pubkey)?.avatar ?? null;
}
