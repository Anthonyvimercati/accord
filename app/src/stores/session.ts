/**
 * Cycle de vie de la session : onboarding (création/restauration),
 * déverrouillage, connexion au nœud embarqué, profil local.
 */

import { create } from 'zustand';
import { api, rpc } from '../lib/client';
import type { SelfProfile } from '../lib/api';
import {
  createIdentity,
  lockIdentity,
  restoreIdentity,
  unlockIdentity,
  vaultStatus,
  type SessionInfo,
} from '../lib/bridge';
import { clearPendingConversation } from '../lib/notifications';

export type Phase = 'boot' | 'setup' | 'locked' | 'starting' | 'ready' | 'offline';

/** Bornes du pseudo (contrat profile.set : 2 à 32 caractères). */
export const NAME_MIN = 2;
export const NAME_MAX = 32;

/** Longueur maximale de la bio (contrat profile.set : 2048 caractères). */
export const BIO_MAX = 2048;

/** Longueur maximale des pronoms (contrat profile.set : 40 caractères). */
export const PRONOUNS_MAX = 40;

/** Vrai si le pseudo (une fois épuré) respecte les bornes du contrat. */
export function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX;
}

/** Nom affichable de l'utilisateur local : pseudo, repli code ami. */
export function selfDisplayName(self: SelfProfile): string {
  if (self.name !== null && self.name.trim() !== '') return self.name;
  return self.friend_code;
}

interface SessionState {
  phase: Phase;
  self: SelfProfile | null;
  /** Phrase de récupération à afficher UNE fois après création, puis effacée. */
  recoveryPhrase: string | null;
  /** Vrai après création/restauration tant qu'aucun pseudo n'est choisi. */
  askName: boolean;
  error: string | null;
  init: () => Promise<void>;
  create: (passphrase: string) => Promise<void>;
  restore: (phrase: string, passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  /**
   * Logs out without quitting: stops the node (in-memory keys wiped host
   * side), closes the RPC link and lands on the unlock screen, exactly like
   * a fresh launch on an existing vault.
   */
  lock: () => Promise<void>;
  ackRecoveryPhrase: () => void;
  /** Définit le pseudo (profile.set) puis rafraîchit le profil local. */
  setName: (name: string) => Promise<void>;
  /** Définit la bio (profile.set ; chaîne vide = effacer) puis rafraîchit. */
  setBio: (bio: string) => Promise<void>;
  /** Définit les pronoms (profile.set ; chaîne vide = effacer) puis rafraîchit. */
  setPronouns: (pronouns: string) => Promise<void>;
  /** Fixe ou efface la couleur d'accent (profile.set ; `null` = effacer). */
  setAccentColor: (color: number | null) => Promise<void>;
  /** Fixe ou efface la couleur de fond de bannière (profile.set ; `null` = effacer). */
  setBannerColor: (color: number | null) => Promise<void>;
  /**
   * Publie l'avatar (profile.set_avatar, PNG/JPEG/WebP en base64) puis
   * rafraîchit le profil local ; `null` retire l'avatar.
   */
  setAvatar: (dataB64: string | null, mime?: string) => Promise<void>;
  /**
   * Publie la bannière de profil (profile.set_banner, image paysage PNG/JPEG/
   * WebP en base64) puis rafraîchit le profil local ; `null` retire la bannière.
   */
  setBanner: (dataB64: string | null, mime?: string) => Promise<void>;
  /** Écarte l'écran « Choisis ton pseudo » sans définir de pseudo. */
  skipNamePrompt: () => void;
}

async function attach(session: SessionInfo): Promise<SelfProfile> {
  await rpc.connect(session.port, session.token);
  return api.identitySelf();
}

export const useSession = create<SessionState>((set) => {
  rpc.onStatus((status) => {
    // Une fois prêt, reflète les coupures de lien dans l'UI.
    set((s) => {
      if (s.phase !== 'ready' && s.phase !== 'offline') return s;
      return { ...s, phase: status === 'ready' ? 'ready' : 'offline' };
    });
  });

  return {
    phase: 'boot',
    self: null,
    recoveryPhrase: null,
    askName: false,
    error: null,

    init: async () => {
      try {
        const status = await vaultStatus();
        set({ phase: status === 'absent' ? 'setup' : 'locked', error: null });
      } catch (e) {
        set({ phase: 'setup', error: e instanceof Error ? e.message : String(e) });
      }
    },

    create: async (passphrase) => {
      set({ phase: 'starting', error: null });
      try {
        const created = await createIdentity(passphrase);
        const self = await attach(created.session);
        set({
          phase: 'ready',
          self,
          recoveryPhrase: created.recovery_phrase,
          askName: self.name === null,
        });
      } catch (e) {
        set({
          phase: 'setup',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    restore: async (phrase, passphrase) => {
      set({ phase: 'starting', error: null });
      try {
        const session = await restoreIdentity(phrase, passphrase);
        const self = await attach(session);
        set({ phase: 'ready', self, recoveryPhrase: null, askName: self.name === null });
      } catch (e) {
        set({
          phase: 'setup',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    unlock: async (passphrase) => {
      set({ phase: 'starting', error: null });
      try {
        const session = await unlockIdentity(passphrase);
        const self = await attach(session);
        // Pas d'invite au pseudo au déverrouillage : compte déjà établi.
        set({ phase: 'ready', self, recoveryPhrase: null, askName: false });
      } catch (e) {
        set({
          phase: 'locked',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    lock: async () => {
      // Land on the unlock screen first, like a cold start on an existing
      // vault: the RPC 'closed' status below must never bounce the phase
      // through 'offline' (the onStatus guard only touches ready/offline).
      set({ phase: 'locked', self: null, recoveryPhrase: null, askName: false, error: null });
      clearPendingConversation();
      rpc.close();
      try {
        const status = await lockIdentity();
        // Vault file gone meanwhile: fall back to onboarding, like init().
        if (status === 'absent') set({ phase: 'setup' });
      } catch (e) {
        // Stay on the unlock screen: a later unlock restarts the node and
        // replaces any node that failed to stop.
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },

    ackRecoveryPhrase: () => set({ recoveryPhrase: null }),

    setName: async (name) => {
      await api.profileSet({ name: name.trim() });
      // Rafraîchit le profil local pour refléter le pseudo partout.
      const self = await api.identitySelf();
      set({ self, askName: false });
    },

    setBio: async (bio) => {
      await api.profileSet({ bio: bio.trim() });
      const self = await api.identitySelf();
      set({ self });
    },

    setPronouns: async (pronouns) => {
      await api.profileSet({ pronouns: pronouns.trim() });
      const self = await api.identitySelf();
      set({ self });
    },

    setAccentColor: async (color) => {
      await api.profileSet({ accent_color: color });
      const self = await api.identitySelf();
      set({ self });
    },

    setBannerColor: async (color) => {
      await api.profileSet({ banner_color: color });
      const self = await api.identitySelf();
      set({ self });
    },

    setAvatar: async (dataB64, mime) => {
      await api.profileSetAvatar(dataB64, mime);
      const self = await api.identitySelf();
      set({ self });
    },

    setBanner: async (dataB64, mime) => {
      await api.profileSetBanner(dataB64, mime);
      const self = await api.identitySelf();
      set({ self });
    },

    skipNamePrompt: () => set({ askName: false }),
  };
});
