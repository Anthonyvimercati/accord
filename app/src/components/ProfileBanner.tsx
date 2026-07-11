/**
 * Bandeau de bannière de profil, partagé par `ProfilePopover` (carte de
 * profil complète) et `UserMenu` (mini carte compacte) : charge le blob par
 * son hash Merkle (comme `Avatar`) et l'affiche en paysage ; repli sur la
 * couleur de bannière tant qu'aucune image n'est définie (l'image l'emporte
 * toujours, y compris pendant son chargement ou en cas d'échec) ; fond
 * neutre si ni image ni couleur.
 */

import { useEffect, useState } from 'react';
import { profileColorCss } from '../lib/color';
import { lireFichier } from '../lib/files';

export function ProfileBanner({
  hash,
  hint,
  color,
  heightClassName = 'h-20',
}: {
  hash: string | null;
  hint: string;
  color: number | null;
  /** Hauteur Tailwind (`h-*`) — plus compacte dans `UserMenu` que dans `ProfilePopover`. */
  heightClassName?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (hash === null) return undefined;
    lireFichier(hash, hint)
      .then((blobUrl) => {
        if (alive) setUrl(blobUrl);
      })
      .catch(() => {
        // Bannière indisponible : on garde le fond neutre.
      });
    return () => {
      alive = false;
    };
  }, [hash, hint]);

  // Aucune image annoncée (`hash === null`) : la couleur de bannière tient
  // lieu de repli. Une image annoncée mais encore en chargement ou en échec
  // garde le fond neutre — jamais la couleur, pour ne pas laisser croire que
  // l'image a été remplacée.
  const colorHex = hash === null ? profileColorCss(color) : null;

  return (
    <div className={`relative overflow-hidden ${heightClassName}`}>
      {url === null ? (
        <div
          aria-hidden
          data-testid="profile-banner-fill"
          className={colorHex === null ? 'h-full bg-rail' : 'h-full'}
          style={colorHex !== null ? { backgroundColor: colorHex } : undefined}
        />
      ) : (
        <img src={url} alt="" aria-hidden className="h-full w-full object-cover" />
      )}
      {/* Fondu bas de bannière vers la surface de verre du panneau. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-10 bg-gradient-to-b from-transparent to-modal/70"
      />
    </div>
  );
}
