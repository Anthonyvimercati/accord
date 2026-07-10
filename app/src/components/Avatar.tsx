/**
 * Avatar rond : image de profil (racine Merkle lue via `lireFichier`) quand
 * un hash est fourni, repli initiales + couleur stable pendant le chargement
 * et en cas d'échec (avatar indisponible, pair injoignable…).
 */

import { useEffect, useState } from 'react';
import { lireFichier } from '../lib/files';
import { avatarColor, initials } from '../lib/format';

interface AvatarProps {
  id: string;
  name: string;
  size?: number;
  /** Racine Merkle de l'image (hex 64) ; absent ou `null` = initiales. */
  avatarHash?: string | null;
  /** Pair source probable du téléchargement (clé publique hex). */
  hint?: string;
  /**
   * Présence : `true` en ligne (pastille verte), `false` hors ligne (grise),
   * `undefined` = pas de pastille (contexte sans présence connue).
   */
  online?: boolean | undefined;
}

export function Avatar({
  id,
  name,
  size = 40,
  avatarHash = null,
  hint,
  online,
}: AvatarProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (avatarHash === null) return undefined;
    lireFichier(avatarHash, hint)
      .then((blobUrl) => {
        if (alive) setUrl(blobUrl);
      })
      .catch(() => {
        // Image indisponible : on reste sur les initiales.
      });
    return () => {
      alive = false;
    };
  }, [avatarHash, hint]);

  const cercle = (
    <div
      aria-hidden
      className="flex h-full w-full items-center justify-center overflow-hidden rounded-full font-semibold text-white"
      style={{ fontSize: size * 0.4, backgroundColor: avatarColor(id) }}
    >
      {url === null ? (
        initials(name)
      ) : (
        <img src={url} alt="" className="h-full w-full object-cover" />
      )}
    </div>
  );

  // Sans présence connue : cercle nu (aucun changement de layout).
  if (online === undefined) {
    return (
      <div className="shrink-0" style={{ width: size, height: size }}>
        {cercle}
      </div>
    );
  }

  // Avec présence : pastille verte/grise en bas à droite.
  const pastille = Math.max(8, Math.round(size * 0.3));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {cercle}
      <span
        aria-label={online ? 'en ligne' : 'hors ligne'}
        className={`absolute bottom-0 right-0 rounded-full border-2 border-rail ${
          online ? 'bg-green' : 'bg-faint'
        }`}
        style={{ width: pastille, height: pastille }}
      />
    </div>
  );
}
