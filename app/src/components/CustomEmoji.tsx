/**
 * Émoji custom de serveur : image chargée par sa racine Merkle (`lireFichier`),
 * repli sur le jeton texte `:name:` pendant le chargement ou en cas d'échec
 * (émoji retiré, pair injoignable…). Rendu en ligne à la hauteur du texte par
 * défaut, ou à une taille fixe (grille de gestion, pastille de réaction).
 */

import { useEffect, useState } from 'react';
import { lireFichier } from '../lib/files';
import { jetonEmojiTexte } from '../lib/emoji';

interface CustomEmojiProps {
  name: string;
  merkleRoot: string;
  /** Pair source probable pour le téléchargement de l'image. */
  hint?: string | undefined;
  /** Taille en px ; par défaut, rendu en ligne (hauteur du texte). */
  size?: number | undefined;
}

export function CustomEmoji({ name, merkleRoot, hint, size }: CustomEmojiProps) {
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

  // Inline par défaut : 22px (proportion Discord — 1.375em pour un texte de
  // 15-16px), aligné à la ligne de base, jamais déformé ni arrondi (l'image
  // est transparente, un radius la rognerait). `size` (pastilles de réaction,
  // grille de gestion) prime.
  const dim = size !== undefined ? `${size}px` : '22px';
  return (
    <img
      src={url}
      alt={code}
      title={code}
      className="inline-block shrink-0 align-text-bottom object-contain"
      style={{ height: dim, width: dim }}
    />
  );
}
