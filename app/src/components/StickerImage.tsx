/**
 * Sticker de serveur : image chargée par sa racine Merkle (`lireFichier`),
 * repli sur le jeton texte `:name:` pendant le chargement ou en cas d'échec
 * (sticker retiré, pair injoignable…) — même mécanisme que `CustomEmoji`.
 * Distinct de `CustomEmoji` : rendu en bloc (jamais inline au texte), taille
 * fixe bien plus grande, coins légèrement arrondis (`rounded-md`, jamais
 * plus) plutôt qu'un carré net — un sticker est un message à part entière,
 * pas un jeton inséré dans une phrase.
 */

import { useEffect, useState } from 'react';
import { jetonEmojiTexte } from '../lib/emoji';
import { lireFichier } from '../lib/files';

/** Taille d'affichage d'un sticker dans le corps d'un message (px). */
export const STICKER_MESSAGE_SIZE_PX = 160;

interface StickerImageProps {
  name: string;
  merkleRoot: string;
  /** Pair source probable pour le téléchargement de l'image. */
  hint?: string | undefined;
  /** Taille en px ; par défaut, taille d'affichage dans le fil (160 px). */
  size?: number | undefined;
}

export function StickerImage({
  name,
  merkleRoot,
  hint,
  size = STICKER_MESSAGE_SIZE_PX,
}: StickerImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const code = jetonEmojiTexte(name);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    lireFichier(merkleRoot, hint)
      .then((blobUrl) => {
        if (alive) setUrl(blobUrl);
      })
      .catch(() => {
        // Image indisponible : on garde le jeton texte, inoffensif.
      });
    return () => {
      alive = false;
    };
  }, [merkleRoot, hint]);

  if (url === null) {
    return <span className="text-muted">{code}</span>;
  }

  return (
    <img
      src={url}
      alt={code}
      title={code}
      className="block shrink-0 rounded-md object-contain"
      style={{ height: size, width: size }}
    />
  );
}
