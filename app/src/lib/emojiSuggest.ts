/**
 * Autocomplétion émoji du composeur (`:requete`) — logique PURE, miroir de
 * `lib/mentions` pour les `@mentions` : détection du jeton actif sous le
 * caret, puis suggestions classées (préfixe avant sous-chaîne) parmi les
 * émojis Unicode embarqués (mots-clés fr/en) et les émojis custom du contexte.
 * L'insertion et le clavier restent au composeur (`MessageInput`).
 */

import { EMOJIS_UNICODE } from './emoji';

/** Jeton `:requete` actif sous le caret (position du `:` incluse). */
export interface ActiveEmojiToken {
  start: number;
  query: string;
}

/** Caractères permis dans une requête d'émoji (noms custom + mots-clés). */
const EMOJI_QUERY_CHAR = /[a-z0-9_+-]/i;

/** Longueur minimale de requête avant d'ouvrir les suggestions. */
export const EMOJI_QUERY_MIN = 2;

/**
 * Jeton d'émoji actif se terminant au caret, ou `null`. Le `:` déclencheur
 * doit ouvrir un mot (début de texte ou après un blanc) — `http://` ou
 * `12:30` ne déclenchent donc jamais — et la requête doit faire au moins
 * `EMOJI_QUERY_MIN` caractères (un `:` seul reste de la ponctuation).
 */
export function findActiveEmojiToken(
  text: string,
  caret: number,
): ActiveEmojiToken | null {
  let i = Math.min(caret, text.length) - 1;
  while (i >= 0) {
    const ch = text[i] ?? '';
    if (ch === ':') {
      const before = i > 0 ? (text[i - 1] ?? '') : '';
      if (i === 0 || /\s/.test(before)) {
        const query = text.slice(i + 1, caret);
        return query.length >= EMOJI_QUERY_MIN ? { start: i, query } : null;
      }
      return null;
    }
    if (!EMOJI_QUERY_CHAR.test(ch)) return null;
    i -= 1;
  }
  return null;
}

/** Suggestion : émoji Unicode (avec le mot-clé affiché) ou custom du serveur. */
export type EmojiSuggestion =
  | { kind: 'unicode'; char: string; name: string }
  | { kind: 'custom'; name: string; merkleRoot: string };

/** Émoji custom candidat (forme minimale du contrat `groups.state.emojis`). */
export interface CustomEmojiCandidate {
  name: string;
  merkle_root: string;
}

/** Rang d'un libellé face à la requête : préfixe (0), sous-chaîne (1), aucun (-1). */
function rang(label: string, query: string): number {
  if (label.startsWith(query)) return 0;
  return label.includes(query) ? 1 : -1;
}

/**
 * Suggestions pour `query` (insensible à la casse), customs du contexte
 * d'abord à rang égal, préfixes avant sous-chaînes, bornées à `max`. Pour un
 * Unicode, `name` est le premier mot-clé correspondant (affichage).
 */
export function suggestEmojis(
  query: string,
  customs: readonly CustomEmojiCandidate[],
  max = 8,
): EmojiSuggestion[] {
  const q = query.toLowerCase();
  if (q.length < EMOJI_QUERY_MIN) return [];
  const ranked: { rank: number; suggestion: EmojiSuggestion }[] = [];
  for (const c of customs) {
    const r = rang(c.name.toLowerCase(), q);
    if (r >= 0) {
      ranked.push({
        rank: r,
        suggestion: { kind: 'custom', name: c.name, merkleRoot: c.merkle_root },
      });
    }
  }
  for (const categorie of EMOJIS_UNICODE) {
    for (const e of categorie.emojis) {
      let best = -1;
      let mot = '';
      for (const k of e.keywords) {
        const r = rang(k.toLowerCase(), q);
        if (r >= 0 && (best === -1 || r < best)) {
          best = r;
          mot = k;
        }
      }
      if (best >= 0) {
        ranked.push({
          rank: best,
          suggestion: { kind: 'unicode', char: e.char, name: mot },
        });
      }
    }
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Math.max(0, max))
    .map((r) => r.suggestion);
}

/**
 * Remplace le jeton actif par l'émoji choisi (caractère Unicode, ou jeton
 * `:name:` custom) suivi d'un espace, et rend le nouveau texte avec la
 * position de caret à placer après l'insertion.
 */
export function insertEmoji(
  text: string,
  token: ActiveEmojiToken,
  suggestion: EmojiSuggestion,
): { text: string; caret: number } {
  const insert =
    suggestion.kind === 'unicode' ? `${suggestion.char} ` : `:${suggestion.name}: `;
  const fin = token.start + 1 + token.query.length;
  const next = text.slice(0, token.start) + insert + text.slice(fin);
  return { text: next, caret: token.start + insert.length };
}
