/**
 * Commandes slash type Discord : transforment le texte du composeur à
 * l'envoi si (et seulement si) il commence EXACTEMENT par une commande
 * connue (`/mot` en tout début de message, sans espace avant). Un `/foo`
 * inconnu — ou tout texte qui ne matche pas — part tel quel : ces commandes
 * ne sont qu'un raccourci de saisie, jamais une contrainte sur le message.
 */

/** Ajoute `suffix` après le texte restant (espace séparateur si non vide). */
function withSuffix(rest: string, suffix: string): string {
  return rest === '' ? suffix : `${rest} ${suffix}`;
}

/** Enrobe le texte restant entre `open`/`close` (vide si aucun texte). */
function wrap(rest: string, open: string, close: string): string {
  return `${open}${rest}${close}`;
}

const TRANSFORMS: Record<string, (rest: string) => string> = {
  shrug: (rest) => withSuffix(rest, '¯\\_(ツ)_/¯'),
  tableflip: (rest) => withSuffix(rest, '(╯°□°)╯︵ ┻━┻'),
  unflip: (rest) => withSuffix(rest, '┬─┬ ノ( ゜-゜ノ)'),
  me: (rest) => wrap(rest, '*', '*'),
  spoiler: (rest) => wrap(rest, '||', '||'),
};

// Ancrée en tout début de chaîne (aucun espace avant `/`) : « exactement »
// une commande connue au départ du message. `s` : `.` couvre aussi les sauts
// de ligne d'un texte suivant multi-lignes.
const COMMAND_PATTERN = /^\/(shrug|tableflip|unflip|me|spoiler)(?:[ \t]+(.*))?$/s;

/**
 * Applique la commande slash de tête de message, s'il y en a une reconnue.
 * Retourne le texte inchangé sinon (commande inconnue, `/` seul, espace en
 * tête, ou aucune commande).
 */
export function applySlashCommand(text: string): string {
  const match = COMMAND_PATTERN.exec(text);
  if (match === null) return text;
  const command = match[1] ?? '';
  const rest = match[2] ?? '';
  const transform = TRANSFORMS[command];
  return transform === undefined ? text : transform(rest);
}
