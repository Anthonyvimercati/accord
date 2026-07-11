/**
 * Internationalisation typée : le dictionnaire français est la référence de
 * forme, l'anglais doit s'y conformer à la compilation. Accès par objet
 * (`t.friends.title`) — aucune clé magique en chaîne.
 */

import { fr } from './fr';
import { en } from './en';

/**
 * Élargit récursivement les littéraux (figés par `as const` dans fr.ts) en
 * `string`, pour que la forme du dictionnaire serve de référence sans imposer
 * les textes français aux autres langues.
 */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

export type Dict = Widen<typeof fr>;
export type Lang = 'fr' | 'en';

export const dictionaries: Record<Lang, Dict> = { fr, en };

/** Interpole `{name}`-style placeholders dans un libellé. */
export function interpolate(label: string, vars: Record<string, string>): string {
  return label.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}
