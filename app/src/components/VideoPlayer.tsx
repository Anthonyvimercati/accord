/**
 * Lecteur vidéo intégré (D-053) : les pièces jointes vidéo (mime `video/*`,
 * ≤ 8 Mio — borne de la lecture en ligne) se lisent directement dans le fil
 * via une balise `<video controls>`, source en `data:` URL — même chemin
 * content-addressed que les images (`lireFichier`), les `blob:` étant cassés
 * en WKWebView. Progression de téléchargement tant que le blob n'est pas
 * local, erreur explicite ET relançable sinon (l'expéditeur peut être revenu
 * en ligne). Jamais de lecture automatique. Une vidéo dont le codec n'est pas
 * lu par la webview (ex. VP9 sous WKWebView) bascule sur la même carte
 * d'erreur — le téléchargement par la carte de fichier reste possible via le
 * menu contextuel du message.
 */

import { useEffect, useState } from 'react';
import { interpolate } from '../i18n';
import type { FileAttachment } from '../lib/api';
import { lireFichier, observerProgression, statutFichier } from '../lib/files';
import { useT } from '../stores/ui';

export function VideoPlayer({
  piece,
  hint,
}: {
  piece: FileAttachment;
  hint?: string | undefined;
}) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [echec, setEchec] = useState(false);
  const [progression, setProgression] = useState<{ done: number; total: number } | null>(
    null,
  );
  // Reprise manuelle : relance le chargement complet (même mécanique que la
  // vignette d'image — un échec n'est jamais définitif, D-052).
  const [tentative, setTentative] = useState(0);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setEchec(false);
    setProgression(null);
    const off = observerProgression(piece.merkle_root, (done, total) => {
      if (alive) setProgression({ done, total });
    });
    statutFichier(piece.merkle_root, hint)
      .then((statut) => {
        if (alive && !statut.complete && statut.total > 0) {
          setProgression((p) => p ?? { done: statut.done, total: statut.total });
        }
      })
      .catch(() => {
        // Sans statut, la barre démarre à zéro.
      });
    lireFichier(piece.merkle_root, hint)
      .then((dataUrl) => {
        if (alive) setUrl(dataUrl);
      })
      .catch(() => {
        if (alive) setEchec(true);
      });
    return () => {
      alive = false;
      off();
    };
  }, [piece.merkle_root, hint, tentative]);

  if (echec) {
    return (
      <div className="flex aspect-video w-96 max-w-full flex-col items-center justify-center gap-2 rounded-lg border border-rail bg-sidebar px-4 text-center text-sm text-faint">
        <span>{t.fichiers.videoIndisponible}</span>
        <button
          type="button"
          onClick={() => setTentative((n) => n + 1)}
          className="rounded-md bg-rail px-3 py-1 text-xs font-medium text-norm transition-colors duration-fast hover:bg-input hover:text-header focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple"
        >
          {t.dm.retry}
        </button>
      </div>
    );
  }

  if (url === null) {
    const pct =
      progression !== null && progression.total > 0
        ? Math.min(100, Math.round((progression.done / progression.total) * 100))
        : 0;
    return (
      <div
        role="status"
        className="flex aspect-video w-96 max-w-full items-center justify-center rounded-lg border border-rail bg-sidebar text-xs text-muted"
      >
        {interpolate(t.fichiers.enTelechargement, { pct: String(pct) })}
      </div>
    );
  }

  return (
    <video
      controls
      preload="metadata"
      src={url}
      aria-label={piece.name}
      className="max-h-80 w-96 max-w-full rounded-lg bg-black"
      onError={() => setEchec(true)}
    />
  );
}
