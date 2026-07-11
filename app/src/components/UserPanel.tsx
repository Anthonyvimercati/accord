/**
 * Panneau utilisateur en bas de la barre latérale : profil + paramètres, et
 * bandeau vocal (mute / raccrocher) au-dessus quand un salon est rejoint.
 * Le clic sur l'avatar/pseudo ouvre le menu utilisateur rapide, façon
 * Discord : statut (En ligne / Inactif / Ne pas déranger / Invisible + texte
 * personnalisé), copie de l'ID, et déconnexion rapide sans passer par les
 * Paramètres (voir `UserMenu`). Le profil complet reste accessible en
 * cliquant son propre avatar/pseudo sur un message envoyé.
 */

import { useEffect, useState } from 'react';
import type { PresenceStatus } from '../lib/api';
import { useFriends } from '../stores/friends';
import { useGroups } from '../stores/groups';
import { selfDisplayName, useSession } from '../stores/session';
import { useUi, useT } from '../stores/ui';
import { useVoice } from '../stores/voice';
import { Avatar } from './Avatar';
import { PresenceDot } from './PresenceDot';
import { ownDotStatus, UserMenu } from './UserMenu';

/** Icône casque, barrée en rouge quand la sortie est coupée (deafen). */
function HeadphonesIcon({ deafened }: { deafened: boolean }) {
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
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1v-4a9 9 0 0 1 18 0v4a1 1 0 0 1-1 1h-2a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
      {deafened && <line className="text-red" x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

/** Icône micro, barrée en rouge quand le micro est coupé. */
function MicIcon({ muted }: { muted: boolean }) {
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
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" x2="12" y1="18" y2="22" />
      <line x1="8" x2="16" y1="22" y2="22" />
      {muted && <line className="text-red" x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

/** Bandeau « Vocal connecté » : nom du groupe, mute micro, raccrocher. */
function VoiceBanner() {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const active = useVoice((s) => s.active);
  const toggleMute = useVoice((s) => s.toggleMute);
  const selfDeafened = useVoice((s) => s.selfDeafened);
  const toggleDeafen = useVoice((s) => s.toggleDeafen);
  const leave = useVoice((s) => s.leave);
  const groupName = useGroups((s) =>
    active === null ? null : (s.states[active.groupId]?.name ?? null),
  );

  if (active === null) return null;

  const onActionError = (): void => toast('error', t.errors.actionFailed);
  const muteLabel = active.muted ? t.voice.unmute : t.voice.mute;
  const deafenLabel = selfDeafened ? t.voice.undeafen : t.voice.deafen;

  const iconButton =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-fast hover:bg-chat-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-rail active:scale-95';

  return (
    <div className="flex items-center justify-between gap-2 border-b border-[color:var(--glass-border)] bg-rail/60 px-2 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-green">
          {t.voice.connected}
        </div>
        <div className="truncate text-xs text-muted">{groupName ?? '…'}</div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label={muteLabel}
          title={muteLabel}
          aria-pressed={active.muted}
          onClick={() => toggleMute().catch(onActionError)}
          className={`${iconButton} ${active.muted ? 'text-red' : 'text-muted hover:text-norm'}`}
        >
          <MicIcon muted={active.muted} />
        </button>
        <button
          type="button"
          aria-label={deafenLabel}
          title={deafenLabel}
          aria-pressed={selfDeafened}
          onClick={() => toggleDeafen().catch(onActionError)}
          className={`${iconButton} ${selfDeafened ? 'text-red' : 'text-muted hover:text-norm'}`}
        >
          <HeadphonesIcon deafened={selfDeafened} />
        </button>
        <button
          type="button"
          aria-label={t.voice.disconnect}
          title={t.voice.disconnect}
          onClick={() => leave().catch(onActionError)}
          className={`${iconButton} text-red`}
        >
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
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v2.28a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-2.68" />
            <path d="M4.51 4.51A2 2 0 0 0 4 6v.28a19.86 19.86 0 0 0 2.28 8.63" />
            <path d="M8.51 8.51a19.87 19.87 0 0 0 3.32 4.56" />
            <line x1="2" x2="22" y1="2" y2="22" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function UserPanel() {
  const t = useT();
  const self = useSession((s) => s.self);
  const phase = useSession((s) => s.phase);
  const openModal = useUi((s) => s.openModal);
  const ownStatus = useFriends((s) => s.ownStatus);
  const ownStatusText = useFriends((s) => s.ownStatusText);
  const loadOwnStatus = useFriends((s) => s.loadOwnStatus);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    loadOwnStatus().catch(() => {
      // Best effort : le statut par défaut (en ligne) reste affiché.
    });
  }, [loadOwnStatus]);

  if (!self) return null;

  const displayName = selfDisplayName(self);
  const dotStatus: PresenceStatus =
    phase === 'ready' ? ownDotStatus(ownStatus) : 'offline';

  return (
    <div className="relative border-t border-[color:var(--glass-border)]">
      <VoiceBanner />
      {userMenuOpen && <UserMenu onClose={() => setUserMenuOpen(false)} />}
      <div className="flex items-center gap-2 bg-rail/60 px-2 py-2">
        <button
          type="button"
          onClick={() => setUserMenuOpen((open) => !open)}
          title={t.profil.userMenu}
          aria-label={t.profil.userMenu}
          aria-haspopup="menu"
          aria-expanded={userMenuOpen}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors duration-fast hover:bg-chat-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-rail"
        >
          <span className="relative shrink-0 rounded-full">
            <Avatar
              id={self.pubkey}
              name={displayName}
              size={32}
              avatarHash={self.avatar}
              hint={self.pubkey}
            />
            <PresenceDot
              status={dotStatus}
              label={t.profil[dotStatus]}
              className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-rail"
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-header">{displayName}</div>
            <div className="truncate text-xs text-faint">
              {(ownStatusText ?? '') !== '' ? ownStatusText : self.friend_code}
            </div>
          </div>
        </button>
        <button
          type="button"
          aria-label={t.settings.title}
          title={t.settings.title}
          onClick={() => openModal({ kind: 'settings' })}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-fast hover:bg-chat-hover hover:text-norm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-rail active:scale-95"
        >
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
            <path d="M10.3 3.6a2 2 0 0 1 3.4 0l.4.7a2 2 0 0 0 2.2.9l.8-.2a2 2 0 0 1 2.4 2.4l-.2.8a2 2 0 0 0 .9 2.2l.7.4a2 2 0 0 1 0 3.4l-.7.4a2 2 0 0 0-.9 2.2l.2.8a2 2 0 0 1-2.4 2.4l-.8-.2a2 2 0 0 0-2.2.9l-.4.7a2 2 0 0 1-3.4 0l-.4-.7a2 2 0 0 0-2.2-.9l-.8.2a2 2 0 0 1-2.4-2.4l.2-.8a2 2 0 0 0-.9-2.2l-.7-.4a2 2 0 0 1 0-3.4l.7-.4a2 2 0 0 0 .9-2.2l-.2-.8a2 2 0 0 1 2.4-2.4l.8.2a2 2 0 0 0 2.2-.9l.4-.7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
