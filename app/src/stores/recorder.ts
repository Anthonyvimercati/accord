/**
 * Coordination de lecture des messages vocaux : un seul `VoiceMessagePlayer`
 * actif à la fois dans tout le fil — en démarrer un met implicitement les
 * autres en pause (chaque lecteur observe `activePlayer` et se met en pause
 * dès qu'il n'est plus la cible). Store dédié plutôt que `stores/ui.ts` :
 * état ponctuel propre aux messages vocaux, sans rapport avec les
 * préférences ou modales de l'UI générale.
 */

import { create } from 'zustand';

interface RecorderState {
  /** Identifiant (`React.useId`) du lecteur en cours de lecture, `null` si aucun. */
  activePlayer: string | null;
  /** Déclare `id` comme lecteur actif ; `null` efface (lecture terminée/mise en pause). */
  setActivePlayer: (id: string | null) => void;
}

export const useRecorder = create<RecorderState>((set) => ({
  activePlayer: null,
  setActivePlayer: (id) => set({ activePlayer: id }),
}));
