/**
 * Signal minimal « ouvre l'éditeur en place pour ce message », déclenché
 * depuis un composant autre que `MessageList` (le composeur, flèche Haut sur
 * message vide — voir `MessageInput`). Même schéma que `mentionInsert` dans
 * `stores/ui.ts` : un `nonce` force le redéclenchement même pour une cible
 * identique. `MessageList` reste seul propriétaire de l'état d'édition
 * (`editingId`) ; ce store ne fait que lui transmettre une requête externe,
 * sans dupliquer sa logique d'édition.
 */

import { create } from 'zustand';

interface MessageEditState {
  request: { msgId: string; nonce: number } | null;
  /** Demande l'ouverture de l'éditeur en place pour `msgId`. */
  requestEdit: (msgId: string) => void;
  /** Consomme la requête courante (évitant tout redéclenchement en boucle). */
  clearEditRequest: () => void;
}

export const useMessageEdit = create<MessageEditState>((set) => ({
  request: null,
  requestEdit: (msgId) =>
    set((s) => ({ request: { msgId, nonce: (s.request?.nonce ?? 0) + 1 } })),
  clearEditRequest: () => set({ request: null }),
}));
