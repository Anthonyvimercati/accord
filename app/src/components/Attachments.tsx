/**
 * Pièces jointes d'un message : vignette inline pour les images (progression
 * du téléchargement via event.file_progress/files.status, clic = plein
 * écran), carte de fichier téléchargeable sinon. Au-delà de 8 Mio (borne
 * `files.read`), ni aperçu ni téléchargement — carte avec explication.
 */

import { useEffect, useState } from 'react';
import { interpolate } from '../i18n';
import type { FileAttachment } from '../lib/api';
import { estImage, MAX_TAILLE_PIECE } from '../lib/attachments';
import { lireFichier, observerProgression, statutFichier } from '../lib/files';
import { tailleLisible } from '../lib/format';
import { useUi, useT } from '../stores/ui';

/** Plein écran très simple : clic n'importe où ou Échap pour fermer. */
function Lightbox({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={name}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
      onClick={onClose}
    >
      <img
        src={url}
        alt={name}
        className="max-h-full max-w-full rounded object-contain"
      />
      <button
        type="button"
        aria-label={t.fichiers.fermerApercu}
        title={t.fichiers.fermerApercu}
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full p-2 text-white/80 hover:text-white"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M6.3 5 12 10.6 17.7 5 19 6.3 13.4 12l5.6 5.7-1.3 1.3-5.7-5.6L6.3 19 5 17.7l5.6-5.7L5 6.3 6.3 5Z" />
        </svg>
      </button>
    </div>
  );
}

/** Vignette d'image : progression pendant le téléchargement, puis aperçu. */
function VignetteImage({
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
  const [pleinEcran, setPleinEcran] = useState(false);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setEchec(false);
    setProgression(null);
    const off = observerProgression(piece.merkle_root, (done, total) => {
      if (alive) setProgression({ done, total });
    });
    // Progression initiale en best effort (téléchargement déjà entamé).
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
      .then((blobUrl) => {
        if (alive) setUrl(blobUrl);
      })
      .catch(() => {
        if (alive) setEchec(true);
      });
    return () => {
      alive = false;
      off();
    };
  }, [piece.merkle_root, hint]);

  if (echec) {
    return (
      <div className="flex h-24 w-64 max-w-full items-center justify-center rounded-lg border border-rail bg-sidebar px-4 text-sm text-faint">
        {t.fichiers.imageIndisponible}
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
        className="flex h-40 w-64 max-w-full flex-col items-center justify-center gap-2 rounded-lg border border-rail bg-sidebar px-4"
      >
        <div className="text-xs text-muted">
          {interpolate(t.fichiers.enTelechargement, { pct: String(pct) })}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-input">
          <div
            className="h-full origin-left rounded-full bg-blurple"
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </div>
        <div className="w-full truncate text-center text-xs text-faint">{piece.name}</div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={interpolate(t.fichiers.agrandir, { name: piece.name })}
        title={piece.name}
        onClick={() => setPleinEcran(true)}
        className="w-fit rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple"
      >
        <img
          src={url}
          alt={piece.name}
          className="max-h-80 max-w-full rounded-lg object-contain"
        />
      </button>
      {pleinEcran && (
        <Lightbox url={url} name={piece.name} onClose={() => setPleinEcran(false)} />
      )}
    </>
  );
}

/**
 * Carte de fichier : icône, nom, taille lisible et bouton de téléchargement
 * (`lireFichier` → lien `download`) — désactivé au-delà de 8 Mio.
 */
function CarteFichier({
  piece,
  hint,
  mention,
}: {
  piece: FileAttachment;
  hint?: string | undefined;
  mention?: string | undefined;
}) {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const toast = useUi((s) => s.toast);
  const [occupe, setOccupe] = useState(false);
  const tropGros = piece.size > MAX_TAILLE_PIECE;

  const telecharger = async (): Promise<void> => {
    if (occupe || tropGros) return;
    setOccupe(true);
    try {
      const url = await lireFichier(piece.merkle_root, hint);
      const lien = document.createElement('a');
      lien.href = url;
      lien.download = piece.name;
      lien.click();
    } catch {
      toast('error', t.fichiers.telechargementEchoue);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-rail bg-sidebar px-3 py-2">
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
        className="shrink-0 text-faint"
      >
        <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.8a2 2 0 0 0-.6-1.4l-4.8-4.8A2 2 0 0 0 13.2 2H6Zm7 1.5L18.5 9H14a1 1 0 0 1-1-1V3.5Z" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-header" title={piece.name}>
          {piece.name}
        </div>
        <div className="truncate text-xs text-faint">
          {tailleLisible(piece.size, lang)}
          {mention !== undefined && ` — ${mention}`}
        </div>
        {tropGros && (
          <div className="text-xs text-faint">{t.fichiers.telechargementImpossible}</div>
        )}
      </div>
      <button
        type="button"
        aria-label={interpolate(t.fichiers.telecharger, { name: piece.name })}
        title={
          tropGros
            ? t.fichiers.telechargementImpossible
            : interpolate(t.fichiers.telecharger, { name: piece.name })
        }
        disabled={tropGros || occupe}
        onClick={() => void telecharger()}
        className="rounded p-1.5 text-muted transition-colors enabled:hover:bg-chat-hover enabled:hover:text-norm disabled:opacity-40"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 0 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4L11 13.6V4a1 1 0 0 1 1-1Zm-7 15a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z" />
        </svg>
      </button>
    </div>
  );
}

/** Pièces jointes de l'enveloppe d'un message, empilées sous le corps. */
export function AttachmentRow({
  pieces,
  hint,
}: {
  pieces: readonly FileAttachment[];
  hint?: string | undefined;
}) {
  const t = useT();
  if (pieces.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col items-start gap-1.5">
      {pieces.map((piece, i) =>
        estImage(piece.mime) && piece.size <= MAX_TAILLE_PIECE ? (
          <VignetteImage key={`${piece.merkle_root}-${i}`} piece={piece} hint={hint} />
        ) : (
          <CarteFichier
            key={`${piece.merkle_root}-${i}`}
            piece={piece}
            hint={hint}
            mention={estImage(piece.mime) ? t.fichiers.apercuTropVolumineux : undefined}
          />
        ),
      )}
    </div>
  );
}
