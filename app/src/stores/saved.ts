/**
 * Messages enregistrés (favoris) — purement LOCAUX, persistés en localStorage,
 * jamais transmis au réseau. On garde un instantané minimal (auteur, texte,
 * horodatage) plus la vue d'origine pour permettre le saut au message. C'est
 * l'équivalent Accord des « messages sauvegardés » : un pense-bête privé, dans
 * l'esprit vie-privée du produit (rien ne quitte l'appareil).
 */

import { create } from 'zustand';
import type { View } from './ui';

const STORAGE_KEY = 'accord.saved';
/** Plafond dur : au-delà, les plus anciens sont évincés (liste bornée). */
const MAX_SAVED = 200;

export interface SavedMessage {
  /** Identifiant du message d'origine (clé d'unicité + cible de saut). */
  msgId: string;
  /** Vue d'origine (MP ou salon) pour rouvrir et sauter au message. */
  view: View;
  /** Clé publique de l'auteur (le nom est résolu à l'affichage). */
  author: string;
  /** Instantané du texte au moment de l'enregistrement. */
  text: string;
  /** Horodatage du message d'origine (ms). */
  ts: number;
  /** Horodatage de l'enregistrement (ms) — tri du plus récent au plus ancien. */
  savedAt: number;
}

function estSavedMessage(x: unknown): x is SavedMessage {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.msgId === 'string' &&
    typeof o.author === 'string' &&
    typeof o.text === 'string' &&
    typeof o.ts === 'number' &&
    typeof o.savedAt === 'number' &&
    typeof o.view === 'object' &&
    o.view !== null &&
    typeof (o.view as Record<string, unknown>).kind === 'string'
  );
}

function charger(): SavedMessage[] {
  try {
    const brut = window.localStorage.getItem(STORAGE_KEY);
    if (brut === null) return [];
    const parsed: unknown = JSON.parse(brut);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(estSavedMessage);
  } catch {
    return [];
  }
}

function persister(items: SavedMessage[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Stockage indisponible : la liste reste en mémoire pour la session.
  }
}

interface SavedState {
  items: SavedMessage[];
  isSaved: (msgId: string) => boolean;
  /** Bascule : enregistre `entry` s'il est absent, le retire sinon. */
  toggle: (entry: Omit<SavedMessage, 'savedAt'>, now: number) => void;
  remove: (msgId: string) => void;
  clear: () => void;
}

export const useSaved = create<SavedState>((set, get) => ({
  items: charger(),
  isSaved: (msgId) => get().items.some((m) => m.msgId === msgId),
  toggle: (entry, now) =>
    set((s) => {
      const exists = s.items.some((m) => m.msgId === entry.msgId);
      const items = exists
        ? s.items.filter((m) => m.msgId !== entry.msgId)
        : [{ ...entry, savedAt: now }, ...s.items].slice(0, MAX_SAVED);
      persister(items);
      return { items };
    }),
  remove: (msgId) =>
    set((s) => {
      const items = s.items.filter((m) => m.msgId !== msgId);
      persister(items);
      return { items };
    }),
  clear: () => {
    persister([]);
    return set({ items: [] });
  },
}));
