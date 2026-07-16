/**
 * Sondages de salon (`groups.polls.*`, D-048) : bornes de question/options du
 * contrat `groups.send` (sondage), vérifiées en **octets UTF-8** — un émoji
 * ou un caractère accentué composé peut peser plusieurs octets, donc une
 * borne en caractères laisserait passer côté client un texte que le nœud
 * refuserait au décodage filaire.
 */

/** Bornes de la question (contrat `groups.send` sondage) : 1-300 octets UTF-8. */
export const POLL_QUESTION_MAX = 300;
/** Bornes d'une option (contrat) : 1-100 octets UTF-8. */
export const POLL_OPTION_MAX = 100;
/** Nombre d'options : borne basse (contrat). */
export const POLL_MIN_OPTIONS = 2;
/** Nombre d'options : borne haute (contrat) — largeur de `counts` dans `groups.state.polls`. */
export const POLL_MAX_OPTIONS = 10;
/** Plafond de sondages par groupe (indication client, la borne fait foi côté nœud). */
export const POLL_MAX_PAR_GROUPE = 25;

/** Poids en octets UTF-8 de `text` (un caractère peut peser plusieurs octets). */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Vrai si `question` respecte les bornes du contrat (1-300 octets, non vide). */
export function estQuestionSondageValide(question: string): boolean {
  const trimmed = question.trim();
  if (trimmed === '') return false;
  return utf8ByteLength(trimmed) <= POLL_QUESTION_MAX;
}

/** Vrai si `option` respecte les bornes du contrat (1-100 octets, non vide). */
export function estOptionSondageValide(option: string): boolean {
  const trimmed = option.trim();
  if (trimmed === '') return false;
  return utf8ByteLength(trimmed) <= POLL_OPTION_MAX;
}

/** Vrai si `options` respecte les bornes du contrat (2-10 entrées, chacune valide). */
export function estOptionsSondageValides(options: readonly string[]): boolean {
  if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS)
    return false;
  return options.every(estOptionSondageValide);
}
