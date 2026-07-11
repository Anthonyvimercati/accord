/**
 * AutoMod côté rendu (modèle serverless) : les clients honnêtes masquent les
 * mots filtrés du groupe à l'affichage — rien n'est supprimé du réseau. La
 * correspondance est insensible à la casse et par mot entier (frontières
 * Unicode : lettres, chiffres et `_` sont des caractères de mot), donc un mot
 * filtré au milieu d'un autre mot n'est pas masqué.
 */

/** Caractère de masquage affiché à la place d'un mot filtré. */
const MASK_CHAR = '█';

/** Longueur minimale du masque (ne pas révéler les mots très courts). */
const MASK_MIN = 3;

/** Longueur maximale du masque (ne pas révéler les mots très longs). */
const MASK_MAX = 8;

/** Classe des caractères « de mot » pour les frontières Unicode. */
const WORD_CHAR = '[\\p{L}\\p{N}_]';

/** Échappe les métacaractères d'expression régulière d'un mot filtré. */
function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Expression d'un mot filtré : occurrence entière (pas de caractère de mot
 * immédiatement avant ni après), insensible à la casse, Unicode.
 */
function wordPattern(word: string): RegExp {
  return new RegExp(
    `(?<!${WORD_CHAR})${escapeRegExp(word)}(?!${WORD_CHAR})`,
    'giu',
  );
}

/** Mots exploitables d'une liste AutoMod : non vides une fois émondés. */
function usableWords(words: readonly string[]): string[] {
  return words.map((w) => w.trim()).filter((w) => w !== '');
}

/**
 * Masque chaque occurrence (mot entier, insensible à la casse) des mots
 * filtrés par des `█` de longueur bornée ([3, 8]) proche de celle du mot.
 */
export function maskFiltered(text: string, words: readonly string[]): string {
  let result = text;
  for (const word of usableWords(words)) {
    result = result.replace(wordPattern(word), (occurrence) =>
      MASK_CHAR.repeat(Math.min(MASK_MAX, Math.max(MASK_MIN, occurrence.length))),
    );
  }
  return result;
}

/**
 * Vrai si `text` contient au moins un mot filtré (même règle de
 * correspondance que [`maskFiltered`]) — pour l'avertissement émetteur.
 */
export function containsFiltered(text: string, words: readonly string[]): boolean {
  return usableWords(words).some((word) => wordPattern(word).test(text));
}
