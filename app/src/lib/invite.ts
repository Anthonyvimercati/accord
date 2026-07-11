/**
 * Liens d'invitation partageables. Un lien a la forme `accord://invite/<code>`
 * — ce module centralise le préfixe et sa validation côté UI, avant l'appel
 * `groups.invite_link_redeem` (le nœud reste l'autorité finale).
 */

/** Préfixe des liens d'invitation partageables (`accord://invite/<code>`). */
export const INVITE_LINK_PREFIX = 'accord://invite/';

/**
 * Vrai si `code` (déjà découpé côté appelant) est un lien d'invitation
 * partageable bien formé : le préfixe attendu suivi d'au moins un caractère.
 */
export function isInviteLink(code: string): boolean {
  return code.startsWith(INVITE_LINK_PREFIX) && code.length > INVITE_LINK_PREFIX.length;
}
