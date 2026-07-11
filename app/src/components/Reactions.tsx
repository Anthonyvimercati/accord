/**
 * Réactions d'un message : agrégation des paires emoji × auteur en pastilles
 * (emoji, compte, réaction de l'utilisateur) et rangée cliquable sous le
 * corps du message, à la Discord.
 */

import { interpolate } from '../i18n';
import type { Reaction } from '../lib/api';
import { jetonEmojiTexte, nomReactionEmoji } from '../lib/emoji';
import { useT } from '../stores/ui';
import { CustomEmoji } from './CustomEmoji';

/** Pastille agrégée : un emoji, son compte et si l'utilisateur a réagi. */
export interface ReactionPill {
  emoji: string;
  count: number;
  mine: boolean;
}

/**
 * Agrège les réactions brutes en pastilles, dans l'ordre de première
 * apparition de chaque emoji (stable d'un rendu à l'autre).
 */
export function aggregateReactions(
  reactions: readonly Reaction[] | undefined,
  selfPubkey: string | null,
): ReactionPill[] {
  const pills = new Map<string, ReactionPill>();
  for (const { emoji, author } of reactions ?? []) {
    const pill = pills.get(emoji) ?? { emoji, count: 0, mine: false };
    pills.set(emoji, {
      ...pill,
      count: pill.count + 1,
      mine: pill.mine || author === selfPubkey,
    });
  }
  return [...pills.values()];
}

interface ReactionRowProps {
  reactions: readonly Reaction[];
  selfPubkey: string | null;
  /** Bascule sa propre réaction ; absent = pastilles en lecture seule. */
  onToggle?: ((emoji: string) => void) | undefined;
  /** Émojis du serveur (nom → racine Merkle) pour les réactions custom. */
  emojis?: ReadonlyMap<string, string> | undefined;
  /** Pair source probable pour le téléchargement des images d'émoji. */
  hint?: string | undefined;
}

/** Rangée de pastilles sous un message ; rendue seulement si non vide. */
export function ReactionRow({
  reactions,
  selfPubkey,
  onToggle,
  emojis,
  hint,
}: ReactionRowProps) {
  const t = useT();
  const pills = aggregateReactions(reactions, selfPubkey);
  if (pills.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {pills.map((pill) => {
        // Réaction custom `":name:"` : image si l'émoji est connu du serveur.
        const nom = nomReactionEmoji(pill.emoji);
        const merkle = nom !== null ? emojis?.get(nom) : undefined;
        const affichage = nom !== null ? jetonEmojiTexte(nom) : pill.emoji;
        const label = interpolate(t.dm.reactWith, { emoji: affichage });
        return (
          <button
            key={pill.emoji}
            type="button"
            disabled={onToggle === undefined}
            aria-pressed={pill.mine}
            aria-label={label}
            title={label}
            onClick={() => onToggle?.(pill.emoji)}
            className={`badge-pop flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-sm transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-chat ${
              pill.mine
                ? 'border-blurple bg-blurple/10 enabled:hover:border-blurple-hover'
                : 'border-rail/70 bg-input enabled:hover:border-faint'
            }`}
          >
            {merkle !== undefined && nom !== null ? (
              <CustomEmoji name={nom} merkleRoot={merkle} hint={hint} size={16} />
            ) : (
              <span aria-hidden className="text-[13px] leading-none">
                {affichage}
              </span>
            )}
            <span
              className={`text-xs font-semibold leading-none ${pill.mine ? 'text-norm' : 'text-muted'}`}
            >
              {pill.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
