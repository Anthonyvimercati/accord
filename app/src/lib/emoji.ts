/**
 * Émojis : validation et jetons des émojis custom de serveur (contrat
 * `groups.emoji.*`) et jeu d'émojis Unicode courants pour le sélecteur.
 *
 * Conventions de forme (API.md §Groupes) :
 * - dans le texte d'un message, un émoji custom s'écrit `:name:` ;
 * - comme valeur de réaction, il s'écrit `":name:"` (guillemets compris),
 *   ce qui le distingue d'un émoji Unicode et d'un `:name:` textuel.
 */

/** Nom d'émoji custom valide : 2 à 32 caractères parmi a-z, 0-9 et `_`. */
export const EMOJI_NAME_RE = /^[a-z0-9_]{2,32}$/;

/** Vrai si `name` respecte les bornes de nom du contrat `groups.emoji.add`. */
export function estNomEmojiValide(name: string): boolean {
  return EMOJI_NAME_RE.test(name);
}

/** Taille maximale de l'image d'un émoji, une fois décodée (256 Kio). */
export const EMOJI_OCTETS_MAX = 256 * 1024;

/** Nombre maximal d'émojis par serveur (contrat `groups.emoji.add`). */
export const EMOJI_MAX_PAR_SERVEUR = 50;

/** Types MIME acceptés pour un émoji de serveur (contrat). */
export const EMOJI_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

/** Vrai si `mime` est un type d'image accepté pour un émoji. */
export function estMimeEmojiValide(mime: string): boolean {
  return (EMOJI_MIMES as readonly string[]).includes(mime);
}

/** Jeton texte d'un émoji custom dans un message : `:name:`. */
export function jetonEmojiTexte(name: string): string {
  return `:${name}:`;
}

/**
 * Valeur de réaction d'un émoji custom : `":name:"` (guillemets compris),
 * distincte du jeton texte et des émojis Unicode.
 */
export function valeurReactionEmoji(name: string): string {
  return `":${name}:"`;
}

/**
 * Extrait le nom d'un émoji custom depuis une valeur de réaction (`":name:"`),
 * ou `null` si `value` n'est pas une réaction d'émoji custom.
 */
export function nomReactionEmoji(value: string): string | null {
  const m = /^":([a-z0-9_]{2,32}):"$/.exec(value);
  return m?.[1] ?? null;
}

/** Choix issu du sélecteur d'émojis : Unicode direct ou émoji custom nommé. */
export type EmojiPick =
  | { kind: 'unicode'; char: string }
  | { kind: 'custom'; name: string; merkleRoot: string };

/** Jeton à insérer dans le texte pour un choix d'émoji (custom → `:name:`). */
export function jetonTexteEmoji(pick: EmojiPick): string {
  return pick.kind === 'unicode' ? pick.char : jetonEmojiTexte(pick.name);
}

/** Valeur de réaction pour un choix (Unicode direct, custom entre guillemets). */
export function valeurReaction(pick: EmojiPick): string {
  return pick.kind === 'unicode' ? pick.char : valeurReactionEmoji(pick.name);
}

/** Entrée Unicode du sélecteur : caractère + mots-clés de recherche (fr/en). */
export interface EmojiUnicode {
  char: string;
  keywords: readonly string[];
}

/** Catégorie du sélecteur : identifiant (libellé i18n) + émojis. */
export interface CategorieEmoji {
  id: string;
  emojis: readonly EmojiUnicode[];
}

/**
 * Jeu d'émojis Unicode courants, groupés par catégorie. Les mots-clés (fr et
 * en) servent au filtre de recherche du sélecteur ; la liste reste volontairement
 * compacte (chargement instantané, aucune dépendance).
 */
export const EMOJIS_UNICODE: readonly CategorieEmoji[] = [
  {
    id: 'smileys',
    emojis: [
      { char: '😀', keywords: ['sourire', 'smile', 'content', 'happy'] },
      { char: '😄', keywords: ['rire', 'laugh', 'joie', 'joy'] },
      { char: '😁', keywords: ['sourire', 'grin', 'dents'] },
      { char: '😂', keywords: ['pleure', 'rire', 'lol', 'tears'] },
      { char: '🤣', keywords: ['mdr', 'rofl', 'rire'] },
      { char: '😊', keywords: ['sourire', 'timide', 'blush'] },
      { char: '😉', keywords: ['clin', 'oeil', 'wink'] },
      { char: '😍', keywords: ['amour', 'coeur', 'love', 'yeux'] },
      { char: '😘', keywords: ['bisou', 'kiss', 'bise'] },
      { char: '😎', keywords: ['cool', 'lunettes', 'sunglasses'] },
      { char: '🙂', keywords: ['sourire', 'slight', 'ok'] },
      { char: '🤔', keywords: ['reflexion', 'think', 'penser', 'doute'] },
      { char: '😐', keywords: ['neutre', 'neutral', 'blase'] },
      { char: '😴', keywords: ['dormir', 'sleep', 'fatigue'] },
      { char: '😭', keywords: ['pleure', 'cry', 'triste', 'sob'] },
      { char: '😅', keywords: ['gene', 'sweat', 'rire'] },
    ],
  },
  {
    id: 'gestures',
    emojis: [
      { char: '👍', keywords: ['pouce', 'thumbs', 'up', 'ok', 'bien'] },
      { char: '👎', keywords: ['pouce', 'thumbs', 'down', 'non'] },
      { char: '👏', keywords: ['applaudir', 'clap', 'bravo'] },
      { char: '🙏', keywords: ['merci', 'priere', 'pray', 'stp'] },
      { char: '🤝', keywords: ['poignee', 'handshake', 'accord', 'deal'] },
      { char: '👋', keywords: ['coucou', 'wave', 'salut', 'bye'] },
      { char: '✌️', keywords: ['victoire', 'peace', 'paix'] },
      { char: '🤞', keywords: ['croise', 'doigts', 'cross', 'chance'] },
      { char: '💪', keywords: ['muscle', 'force', 'strong'] },
      { char: '🫶', keywords: ['coeur', 'mains', 'love', 'heart'] },
      { char: '👌', keywords: ['ok', 'parfait', 'perfect'] },
      { char: '🙌', keywords: ['hourra', 'raise', 'celebrer'] },
    ],
  },
  {
    id: 'hearts',
    emojis: [
      { char: '❤️', keywords: ['coeur', 'heart', 'amour', 'love', 'rouge'] },
      { char: '🧡', keywords: ['coeur', 'heart', 'orange'] },
      { char: '💛', keywords: ['coeur', 'heart', 'jaune', 'yellow'] },
      { char: '💚', keywords: ['coeur', 'heart', 'vert', 'green'] },
      { char: '💙', keywords: ['coeur', 'heart', 'bleu', 'blue'] },
      { char: '💜', keywords: ['coeur', 'heart', 'violet', 'purple'] },
      { char: '🖤', keywords: ['coeur', 'heart', 'noir', 'black'] },
      { char: '💔', keywords: ['brise', 'broken', 'chagrin'] },
      { char: '💕', keywords: ['coeurs', 'hearts', 'amour'] },
      { char: '💖', keywords: ['coeur', 'sparkle', 'brillant'] },
      { char: '🔥', keywords: ['feu', 'fire', 'chaud', 'lit'] },
      { char: '✨', keywords: ['etoiles', 'sparkles', 'brillant'] },
    ],
  },
  {
    id: 'animals',
    emojis: [
      { char: '🐶', keywords: ['chien', 'dog', 'toutou'] },
      { char: '🐱', keywords: ['chat', 'cat', 'minou'] },
      { char: '🦊', keywords: ['renard', 'fox'] },
      { char: '🐻', keywords: ['ours', 'bear'] },
      { char: '🐼', keywords: ['panda'] },
      { char: '🦁', keywords: ['lion'] },
      { char: '🐸', keywords: ['grenouille', 'frog'] },
      { char: '🐵', keywords: ['singe', 'monkey'] },
      { char: '🦄', keywords: ['licorne', 'unicorn'] },
      { char: '🐢', keywords: ['tortue', 'turtle'] },
      { char: '🦜', keywords: ['perroquet', 'parrot'] },
      { char: '🐝', keywords: ['abeille', 'bee'] },
    ],
  },
  {
    id: 'food',
    emojis: [
      { char: '🍕', keywords: ['pizza'] },
      { char: '🍔', keywords: ['burger', 'hamburger'] },
      { char: '🍟', keywords: ['frites', 'fries'] },
      { char: '🌮', keywords: ['taco'] },
      { char: '🍣', keywords: ['sushi'] },
      { char: '🍩', keywords: ['donut', 'beignet'] },
      { char: '🍪', keywords: ['cookie', 'biscuit'] },
      { char: '🎂', keywords: ['gateau', 'cake', 'anniversaire'] },
      { char: '☕', keywords: ['cafe', 'coffee'] },
      { char: '🍺', keywords: ['biere', 'beer'] },
      { char: '🍷', keywords: ['vin', 'wine'] },
      { char: '🍎', keywords: ['pomme', 'apple'] },
    ],
  },
  {
    id: 'activities',
    emojis: [
      { char: '⚽', keywords: ['foot', 'football', 'soccer', 'ballon'] },
      { char: '🏀', keywords: ['basket', 'basketball'] },
      { char: '🎮', keywords: ['jeu', 'manette', 'game', 'gaming'] },
      { char: '🎧', keywords: ['casque', 'musique', 'headphones'] },
      { char: '🎉', keywords: ['fete', 'party', 'celebration', 'tada'] },
      { char: '🎊', keywords: ['confetti', 'fete'] },
      { char: '🏆', keywords: ['trophee', 'trophy', 'gagne', 'win'] },
      { char: '🎯', keywords: ['cible', 'target', 'dart'] },
      { char: '🎸', keywords: ['guitare', 'guitar'] },
      { char: '🎨', keywords: ['art', 'palette', 'peinture'] },
      { char: '📷', keywords: ['photo', 'camera', 'appareil'] },
      { char: '🚀', keywords: ['fusee', 'rocket', 'lancement'] },
    ],
  },
  {
    id: 'objects',
    emojis: [
      { char: '💻', keywords: ['ordi', 'laptop', 'code', 'ordinateur'] },
      { char: '📱', keywords: ['telephone', 'phone', 'mobile'] },
      { char: '💡', keywords: ['idee', 'idea', 'ampoule', 'light'] },
      { char: '📌', keywords: ['epingle', 'pin', 'punaise'] },
      { char: '📎', keywords: ['trombone', 'clip', 'piece'] },
      { char: '🔒', keywords: ['cadenas', 'lock', 'securite'] },
      { char: '🔑', keywords: ['cle', 'key'] },
      { char: '⏰', keywords: ['reveil', 'alarm', 'heure'] },
      { char: '📚', keywords: ['livres', 'books', 'lecture'] },
      { char: '✏️', keywords: ['crayon', 'pencil', 'ecrire'] },
      { char: '🎁', keywords: ['cadeau', 'gift', 'present'] },
      { char: '💰', keywords: ['argent', 'money', 'sac'] },
    ],
  },
  {
    id: 'symbols',
    emojis: [
      { char: '✅', keywords: ['coche', 'check', 'valide', 'oui', 'ok'] },
      { char: '❌', keywords: ['croix', 'cross', 'non', 'erreur'] },
      { char: '❓', keywords: ['question', 'point'] },
      { char: '❗', keywords: ['exclamation', 'attention'] },
      { char: '⚠️', keywords: ['avertissement', 'warning', 'attention'] },
      { char: '💯', keywords: ['cent', 'hundred', '100', 'parfait'] },
      { char: '⭐', keywords: ['etoile', 'star', 'favori'] },
      { char: '🌟', keywords: ['etoile', 'glowing', 'brille'] },
      { char: '➡️', keywords: ['fleche', 'arrow', 'droite'] },
      { char: '🔴', keywords: ['rond', 'rouge', 'red', 'cercle'] },
      { char: '🟢', keywords: ['rond', 'vert', 'green', 'cercle'] },
      { char: '🔵', keywords: ['rond', 'bleu', 'blue', 'cercle'] },
    ],
  },
];
