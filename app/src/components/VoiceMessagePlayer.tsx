/**
 * Lecteur de message vocal : remplace la carte de fichier générique pour les
 * pièces jointes audio (`AttachmentRow`, mime `audio/*`) — bouton
 * lecture/pause, barre de progression cliquable/clavier, écoulé/durée
 * (`formatDuration`). Octets lus via le même chemin content-addressed que les
 * autres pièces (`lireFichier`), avec la même progression de téléchargement
 * affichée tant que le blob n'est pas encore local (`event.file_progress`).
 *
 * Un seul lecteur actif à la fois dans tout le fil (`stores/recorder.ts`).
 * Ne se lance jamais automatiquement (pas d'`autoPlay`). Le mime/nom de la
 * pièce sont contrôlés par le pair : un flux introuvable ou indécodable
 * retombe sur un état d'erreur explicite, sans planter ni tourner
 * indéfiniment.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { interpolate } from '../i18n';
import type { FileAttachment } from '../lib/api';
import { lireFichier, observerProgression, statutFichier } from '../lib/files';
import { formatDuration } from '../lib/format';
import { useRecorder } from '../stores/recorder';
import { useT } from '../stores/ui';

/** Icône lecture (triangle), traits seuls — voir ICON SPEC (styles/global.css). */
function PlayIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

/** Icône pause (deux barres), même jeu de traits que `PlayIcon`. */
function PauseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

/** Icône micro barré — état d'erreur (flux introuvable ou indécodable). */
function MicOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" x2="12" y1="18" y2="22" />
      <line x1="8" x2="16" y1="22" y2="22" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  );
}

export function VoiceMessagePlayer({
  piece,
  hint,
}: {
  piece: FileAttachment;
  hint?: string | undefined;
}) {
  const t = useT();
  const id = useId();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [echec, setEchec] = useState(false);
  const [progression, setProgression] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setEchec(false);
    setProgression(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
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
      .then((lu) => {
        if (alive) setUrl(lu);
      })
      .catch(() => {
        if (alive) setEchec(true);
      });
    return () => {
      alive = false;
      off();
    };
  }, [piece.merkle_root, hint]);

  // Un seul lecteur actif à la fois : un autre lecteur qui démarre nous
  // met en pause (l'inverse — nous démarrons — est géré par `basculerLecture`).
  const activePlayer = useRecorder((s) => s.activePlayer);
  useEffect(() => {
    if (activePlayer !== id) {
      audioRef.current?.pause();
    }
  }, [activePlayer, id]);

  const basculerLecture = (): void => {
    const audio = audioRef.current;
    if (audio === null || echec) return;
    if (playing) {
      audio.pause();
      return;
    }
    useRecorder.getState().setActivePlayer(id);
    audio.play().catch(() => setEchec(true));
  };

  const dureeSure = Number.isFinite(duration) ? duration : 0;
  const ratioActuel = dureeSure > 0 ? Math.min(1, currentTime / dureeSure) : 0;

  const chercher = (ratio: number): void => {
    const audio = audioRef.current;
    if (audio === null || dureeSure <= 0) return;
    const cible = Math.min(dureeSure, Math.max(0, ratio * dureeSure));
    audio.currentTime = cible;
    setCurrentTime(cible);
  };

  if (echec) {
    return (
      <div className="flex h-14 w-[280px] max-w-full items-center gap-2 rounded-lg bg-input px-3 text-sm text-faint">
        <MicOffIcon />
        <span>{t.vocal.indisponible}</span>
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
        className="flex h-14 w-[280px] max-w-full flex-col justify-center gap-1.5 rounded-lg bg-input px-3"
      >
        <div className="text-xs text-muted">
          {interpolate(t.fichiers.enTelechargement, { pct: String(pct) })}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-rail/60">
          <div
            className="h-full origin-left rounded-full bg-blurple"
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-[280px] max-w-full items-center gap-3 rounded-lg bg-input px-3 py-2.5">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => setEchec(true)}
      />
      <button
        type="button"
        aria-label={playing ? t.vocal.pause : t.vocal.lire}
        title={playing ? t.vocal.pause : t.vocal.lire}
        onClick={basculerLecture}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blurple text-white transition-all duration-fast hover:scale-105 hover:bg-blurple-hover active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-input"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          role="slider"
          tabIndex={0}
          aria-label={t.vocal.progression}
          aria-valuemin={0}
          aria-valuemax={Math.round(dureeSure)}
          aria-valuenow={Math.round(currentTime)}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            chercher(rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              chercher(Math.min(1, ratioActuel + 0.05));
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              chercher(Math.max(0, ratioActuel - 0.05));
            }
          }}
          className="h-1.5 w-full cursor-pointer overflow-hidden rounded-full bg-rail/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple"
        >
          <div
            className="h-full origin-left rounded-full bg-blurple"
            style={{ transform: `scaleX(${ratioActuel})` }}
          />
        </div>
        <div className="mt-1 text-[11px] tabular-nums text-faint">
          {formatDuration(currentTime)} / {formatDuration(dureeSure)}
        </div>
      </div>
    </div>
  );
}
