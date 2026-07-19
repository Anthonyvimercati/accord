/**
 * Émojis récents du sélecteur : liste persistée (localStorage) des derniers
 * émojis choisis (Unicode ou custom), la plus récente en tête, dédupliquée et
 * bornée. La logique pure (ajout / dédup / borne / désérialisation) est testée
 * indépendamment ; l'accès au stockage reste tolérant (indisponible ou
 * corrompu → liste vide ; écriture best-effort).
 */

import type { EmojiPick } from './emoji';

/** Nombre maximal d'émojis récents conservés. */
export const MAX_RECENTS = 24;

/** Clé localStorage de la liste des émojis récents. */
export const RECENTS_STORAGE_KEY = 'accord.emojiRecents';

/** Clé d'identité d'un choix : Unicode par caractère, custom par nom. */
function recentKey(pick: EmojiPick): string {
  return pick.kind === 'unicode' ? `u:${pick.char}` : `c:${pick.name}`;
}

/**
 * Ajoute `pick` en tête de `list`, retire un éventuel doublon (même émoji) et
 * borne le résultat à `max`. Retourne une nouvelle liste (jamais de mutation).
 */
export function addRecent(
  list: readonly EmojiPick[],
  pick: EmojiPick,
  max: number = MAX_RECENTS,
): EmojiPick[] {
  const key = recentKey(pick);
  const withoutDup = list.filter((p) => recentKey(p) !== key);
  return [pick, ...withoutDup].slice(0, Math.max(0, max));
}

/**
 * Barre de réactions rapides : les émojis Unicode récents d'abord (ordre de
 * récence), complétés par `defaults` jusqu'à `n`, sans doublon. Les émojis
 * custom des récents sont ignorés ici — la barre réagit d'un caractère
 * Unicode ; les custom passent par le sélecteur complet.
 */
export function quickReactions(
  list: readonly EmojiPick[],
  defaults: readonly string[],
  n = 6,
): string[] {
  const out: string[] = [];
  const candidats = [
    ...list.filter((p) => p.kind === 'unicode').map((p) => p.char),
    ...defaults,
  ];
  for (const c of candidats) {
    if (!out.includes(c)) out.push(c);
    if (out.length === n) break;
  }
  return out;
}

/** Vrai si `value` est un `EmojiPick` valide (garde de désérialisation). */
function isEmojiPick(value: unknown): value is EmojiPick {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'unicode') return typeof v.char === 'string';
  if (v.kind === 'custom') {
    return typeof v.name === 'string' && typeof v.merkleRoot === 'string';
  }
  return false;
}

/** Normalise une valeur désérialisée en liste d'`EmojiPick` valides et bornée. */
export function parseRecents(value: unknown, max: number = MAX_RECENTS): EmojiPick[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isEmojiPick).slice(0, Math.max(0, max));
}

/** Lecture tolérante des émojis récents (stockage indisponible/corrompu → []). */
export function readRecents(): EmojiPick[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_STORAGE_KEY);
    if (raw === null) return [];
    return parseRecents(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/** Écriture tolérante des émojis récents (best-effort). */
export function writeRecents(list: readonly EmojiPick[]): void {
  try {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Best effort : la liste reste en mémoire pour la session en cours.
  }
}
