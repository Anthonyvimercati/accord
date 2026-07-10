/**
 * Salon vocal : salon actif (un seul à la fois, contrat voix), participants
 * connectés et bascule du micro. Les événements `event.voice_*` du nœud sont
 * appliqués ici ; `sync` resynchronise l'état complet via `voice.status`.
 */

import { create } from 'zustand';
import { api } from '../lib/client';

/** Salon vocal rejoint, vu de l'interface (clés en camelCase). */
export interface ActiveVoice {
  groupId: string;
  channelId: string;
  muted: boolean;
}

/** État de parole d'un participant connecté au salon actif. */
export interface ParticipantState {
  speaking: boolean;
}

interface VoiceState {
  active: ActiveVoice | null;
  /** Participants du salon actif, indexés par clé publique (hex). */
  participants: Map<string, ParticipantState>;
  /** Rejoint un salon vocal ; le nœud quitte l'ancien implicitement. */
  join: (groupId: string, channelId: string) => Promise<void>;
  /** Quitte le salon actif et vide la liste des participants. */
  leave: () => Promise<void>;
  /** Coupe/rétablit le micro (voice.mute) tout en restant dans le salon. */
  toggleMute: () => Promise<void>;
  /** Force l'état du micro (utilisé par l'appui-pour-parler). */
  setMuted: (muted: boolean) => Promise<void>;
  /** Resynchronise l'état local depuis `voice.status` (reprise de session). */
  sync: () => Promise<void>;
  /** Applique `event.voice_joined` (ignoré hors du salon actif). */
  applyJoined: (params: { group_id: string; channel_id: string; pubkey: string }) => void;
  /** Applique `event.voice_left` (ignoré hors du salon actif). */
  applyLeft: (params: { group_id: string; channel_id: string; pubkey: string }) => void;
  /** Applique `event.voice_speaking` sur un participant connu. */
  applySpeaking: (params: { pubkey: string; speaking: boolean }) => void;
}

/** Construit la table des participants (personne ne parle au départ). */
function participantsFrom(pubkeys: string[]): Map<string, ParticipantState> {
  return new Map(pubkeys.map((pubkey) => [pubkey, { speaking: false }]));
}

/** Vrai si l'événement concerne le salon actuellement rejoint. */
function matchesActive(
  active: ActiveVoice | null,
  groupId: string,
  channelId: string,
): active is ActiveVoice {
  return active !== null && active.groupId === groupId && active.channelId === channelId;
}

export const useVoice = create<VoiceState>((set, get) => ({
  active: null,
  participants: new Map(),

  join: async (groupId, channelId) => {
    const { participants } = await api.voiceJoin(groupId, channelId);
    set({
      active: { groupId, channelId, muted: false },
      participants: participantsFrom(participants),
    });
  },

  leave: async () => {
    await api.voiceLeave();
    set({ active: null, participants: new Map() });
  },

  toggleMute: async () => {
    const active = get().active;
    if (active === null) return;
    await get().setMuted(!active.muted);
  },

  setMuted: async (muted) => {
    const active = get().active;
    if (active === null || active.muted === muted) return;
    await api.voiceMute(muted);
    const current = get().active;
    if (current === null) return;
    set({ active: { ...current, muted } });
  },

  sync: async () => {
    const { active } = await api.voiceStatus();
    if (active === null) {
      set({ active: null, participants: new Map() });
      return;
    }
    set({
      active: {
        groupId: active.group_id,
        channelId: active.channel_id,
        muted: active.muted,
      },
      participants: new Map(
        active.participants.map((p) => [p.pubkey, { speaking: p.speaking }]),
      ),
    });
  },

  applyJoined: ({ group_id, channel_id, pubkey }) => {
    set((s) => {
      if (!matchesActive(s.active, group_id, channel_id)) return s;
      if (s.participants.has(pubkey)) return s;
      const participants = new Map(s.participants);
      participants.set(pubkey, { speaking: false });
      return { participants };
    });
  },

  applyLeft: ({ group_id, channel_id, pubkey }) => {
    set((s) => {
      if (!matchesActive(s.active, group_id, channel_id)) return s;
      if (!s.participants.has(pubkey)) return s;
      const participants = new Map(s.participants);
      participants.delete(pubkey);
      return { participants };
    });
  },

  applySpeaking: ({ pubkey, speaking }) => {
    set((s) => {
      const current = s.participants.get(pubkey);
      if (current === undefined || current.speaking === speaking) return s;
      const participants = new Map(s.participants);
      participants.set(pubkey, { speaking });
      return { participants };
    });
  },
}));
