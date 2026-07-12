/**
 * Bouton Soundboard du bandeau vocal : visible uniquement quand un salon vocal
 * de groupe est actif. Il déplie un panneau listant les sons du serveur du
 * salon actif (`state.sounds`) en tuiles : pastille d'initiale à teinte stable
 * (dérivée du nom, `lib/color.hueFromString`), nom lisible, retour visuel de
 * lecture (pulsation brève) et recherche au-delà de quelques sons. Un clic
 * sur une tuile joue le son localement (feedback immédiat de l'émetteur) et
 * demande au nœud de le diffuser aux participants via
 * `groups.soundboard.play`. Import de `playSound` = câblage du gestionnaire
 * `event.soundboard_play` au démarrage (voir `stores/soundboard`).
 */

import { useEffect, useRef, useState } from 'react';
import { interpolate } from '../i18n';
import type { ServerSound } from '../lib/api';
import { api } from '../lib/client';
import { soundBadgeColor } from '../lib/color';
import { hasPerm, PERMISSIONS, useGroups } from '../stores/groups';
import { playSound } from '../stores/soundboard';
import { useUi, useT } from '../stores/ui';
import { useVoice } from '../stores/voice';

/** Durée du retour visuel « en lecture » sur une tuile (ms). */
const PLAYING_PULSE_MS = 900;
/** Au-delà de ce nombre de sons, le panneau affiche un champ de recherche. */
const SEARCH_THRESHOLD = 8;

/** Icône haut-parleur du déclencheur (18 px, à l'unisson du bandeau vocal). */
function SoundboardIcon() {
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
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

/**
 * Tuile d'un son : pastille d'initiale colorée (teinte stable dérivée du
 * nom), nom, écrasement léger au clic (`active:scale`) et pulsation brève de
 * la pastille pendant la lecture — uniquement transform/opacity (compositor).
 */
function SoundTile({
  sound,
  playing,
  onPlay,
}: {
  sound: ServerSound;
  playing: boolean;
  onPlay: (sound: ServerSound) => void;
}) {
  const t = useT();
  const initial = sound.name.charAt(0).toUpperCase();
  return (
    <button
      type="button"
      title={interpolate(t.soundboard.playOf, { name: sound.name })}
      onClick={() => onPlay(sound)}
      className={`group flex items-center gap-2 rounded-md bg-sidebar px-2 py-1.5 text-left transition-[transform,background-color] duration-fast hover:bg-chat-hover active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple ${
        playing ? 'ring-1 ring-blurple' : ''
      }`}
    >
      <span
        aria-hidden
        style={{ backgroundColor: soundBadgeColor(sound.name) }}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[13px] font-bold text-white shadow-1 transition-transform duration-fast group-hover:scale-105 ${
          playing ? 'animate-pulse' : ''
        }`}
      >
        {initial}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-norm">
        {sound.name}
      </span>
    </button>
  );
}

/**
 * `className` reprend le style des boutons d'action du bandeau vocal
 * (`ICON_BUTTON_CLASS`) pour rester visuellement homogène.
 */
export function SoundboardButton({ className }: { className: string }) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const openModal = useUi((s) => s.openModal);
  const active = useVoice((s) => s.active);
  const groupState = useGroups((s) =>
    active === null ? undefined : s.states[active.groupId],
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [playingName, setPlayingName] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current !== null && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Nettoyage du minuteur de pulsation au démontage.
  useEffect(
    () => () => {
      if (pulseTimer.current !== null) clearTimeout(pulseTimer.current);
    },
    [],
  );

  // Le bandeau vocal ne rend ce bouton qu'en vocal de groupe ; garde défensive.
  if (active === null) return null;

  const list = groupState?.sounds ?? [];
  const canManage =
    groupState !== undefined &&
    hasPerm(groupState.my_permissions, PERMISSIONS.MANAGE_EMOJIS);
  const showSearch = list.length > SEARCH_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const filtered = needle === '' ? list : list.filter((s) => s.name.includes(needle));

  const jouer = (sound: ServerSound): void => {
    // Retour visuel immédiat, borné : la pulsation s'éteint d'elle-même.
    setPlayingName(sound.name);
    if (pulseTimer.current !== null) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPlayingName(null), PLAYING_PULSE_MS);
    // Feedback local : le clip est déjà en état (préchargé), aucune source à
    // viser ; l'échec de lecture est signalé par le store (toast).
    void playSound(sound.merkle_root);
    api
      .groupsSoundboardPlay(active.groupId, active.channelId, sound.name)
      .catch(() => toast('error', t.errors.actionFailed));
  };

  const ouvrirReglages = (): void => {
    setOpen(false);
    openModal({ kind: 'serverSettings', groupId: active.groupId, initialTab: 'soundboard' });
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={t.soundboard.open}
        title={t.soundboard.open}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setQuery('');
          setOpen((o) => !o);
        }}
        className={`${className} ${open ? 'text-norm' : 'text-muted hover:text-norm'}`}
      >
        <SoundboardIcon />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t.soundboard.open}
          className="popover-enter absolute bottom-full right-0 z-50 mb-2 w-72 rounded-lg border border-[color:var(--glass-border)] bg-chat p-2 shadow-3"
        >
          <div className="flex items-baseline justify-between px-1 pb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">
              {t.soundboard.open}
            </span>
            {list.length > 0 && (
              <span className="text-[11px] tabular-nums text-faint">{list.length}</span>
            )}
          </div>
          {showSearch && (
            <input
              aria-label={t.soundboard.searchPlaceholder}
              placeholder={t.soundboard.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mb-1.5 w-full rounded-md border border-transparent bg-input px-2 py-1 text-sm text-norm placeholder-faint outline-none transition-colors duration-fast focus:border-blurple/50"
            />
          )}
          {list.length === 0 ? (
            <div className="px-2 py-4 text-center">
              <p className="text-xs text-faint">{t.soundboard.panelEmpty}</p>
              {canManage && (
                <button
                  type="button"
                  onClick={ouvrirReglages}
                  className="mt-2 text-xs font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple"
                >
                  {t.soundboard.openSettings}
                </button>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-faint">
              {t.soundboard.noResults}
            </p>
          ) : (
            <div className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto">
              {filtered.map((sound) => (
                <SoundTile
                  key={sound.name}
                  sound={sound}
                  playing={playingName === sound.name}
                  onPlay={jouer}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
