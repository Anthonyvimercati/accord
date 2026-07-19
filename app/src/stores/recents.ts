/**
 * Émojis récents partagés entre les surfaces (sélecteur d'émojis, barre de
 * réactions rapides) : mince couche réactive au-dessus de `lib/emojiRecents`
 * (persistance localStorage tolérante). Sans ce store, chaque sélecteur tenait
 * sa copie locale et la barre de réactions ne voyait jamais les choix récents.
 */

import { create } from 'zustand';
import type { EmojiPick } from '../lib/emoji';
import { addRecent, readRecents, writeRecents } from '../lib/emojiRecents';

interface EmojiRecentsState {
  list: EmojiPick[];
  /** Ajoute un choix en tête (dédup + borne) et persiste. */
  add: (pick: EmojiPick) => void;
}

export const useEmojiRecents = create<EmojiRecentsState>((set) => ({
  list: readRecents(),
  add: (pick) =>
    set((s) => {
      const next = addRecent(s.list, pick);
      writeRecents(next);
      return { list: next };
    }),
}));
