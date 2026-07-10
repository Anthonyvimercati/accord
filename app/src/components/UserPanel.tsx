/**
 * Panneau utilisateur en bas de la barre latérale : profil + paramètres, et
 * bandeau vocal (mute / raccrocher) au-dessus quand un salon est rejoint.
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import { useGroups } from '../stores/groups';
import { selfDisplayName, useSession } from '../stores/session';
import { useUi, useT } from '../stores/ui';
import { useVoice } from '../stores/voice';
import { Avatar } from './Avatar';

/** Icône micro, barrée en rouge quand le micro est coupé. */
function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M6 10a1 1 0 1 0-2 0 8 8 0 0 0 7 7.9V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.1a8 8 0 0 0 7-7.9 1 1 0 1 0-2 0 6 6 0 0 1-12 0Z" />
      {muted && (
        <path
          className="text-red"
          d="M3.3 2.3a1 1 0 0 1 1.4 0l16 16a1 1 0 0 1-1.4 1.4l-16-16a1 1 0 0 1 0-1.4Z"
        />
      )}
    </svg>
  );
}

/** Bandeau « Vocal connecté » : nom du groupe, mute micro, raccrocher. */
function VoiceBanner() {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const active = useVoice((s) => s.active);
  const toggleMute = useVoice((s) => s.toggleMute);
  const leave = useVoice((s) => s.leave);
  const groupName = useGroups((s) =>
    active === null ? null : (s.states[active.groupId]?.name ?? null),
  );

  if (active === null) return null;

  const onActionError = (): void => toast('error', t.errors.actionFailed);
  const muteLabel = active.muted ? t.voice.unmute : t.voice.mute;

  return (
    <div className="flex items-center justify-between gap-2 border-b border-rail bg-rail/60 px-2 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-green">
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
          className={`rounded p-1.5 hover:bg-chat-hover ${
            active.muted ? 'text-red' : 'text-muted hover:text-norm'
          }`}
        >
          <MicIcon muted={active.muted} />
        </button>
        <button
          type="button"
          aria-label={t.voice.disconnect}
          title={t.voice.disconnect}
          onClick={() => leave().catch(onActionError)}
          className="rounded p-1.5 text-red hover:bg-chat-hover"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 9c-3.9 0-7.5 1.5-10 3.9a2 2 0 0 0-.2 2.7l1.5 1.9a2 2 0 0 0 2.4.6l2.7-1.3a2 2 0 0 0 1.1-1.8v-1.3a10.3 10.3 0 0 1 5 0V15a2 2 0 0 0 1.1 1.8l2.7 1.3a2 2 0 0 0 2.4-.6l1.5-1.9a2 2 0 0 0-.2-2.7A14.6 14.6 0 0 0 12 9Z" />
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
  const openProfile = useUi((s) => s.openProfile);

  if (!self) return null;

  // Ouvre sa propre carte de profil (façon Discord), ancrée sur le bouton
  // cliqué (avatar + pseudo réunis dans un même bouton).
  const ouvrirProfil = (e: ReactMouseEvent<HTMLButtonElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    openProfile(self.pubkey, {
      top: r.top,
      left: r.left,
      bottom: r.bottom,
      right: r.right,
    });
  };

  const displayName = selfDisplayName(self);

  return (
    <div>
      <VoiceBanner />
      <div className="flex items-center gap-2 bg-rail/60 px-2 py-2">
        <button
          type="button"
          onClick={ouvrirProfil}
          title={t.profil.title}
          aria-label={t.profil.title}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-chat-hover"
        >
          <div className="relative shrink-0">
            <Avatar
              id={self.pubkey}
              name={displayName}
              size={32}
              avatarHash={self.avatar}
              hint={self.pubkey}
            />
            <span
              aria-label={phase === 'ready' ? 'en ligne' : 'hors ligne'}
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-rail ${
                phase === 'ready' ? 'bg-green' : 'bg-faint'
              }`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-header">{displayName}</div>
            <div className="truncate text-xs text-faint">{self.friend_code}</div>
          </div>
        </button>
        <button
          type="button"
          aria-label={t.settings.title}
          title={t.settings.title}
          onClick={() => openModal({ kind: 'settings' })}
          className="rounded p-1.5 text-muted hover:bg-chat-hover hover:text-norm"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M10.3 3.6a2 2 0 0 1 3.4 0l.6 1a2 2 0 0 0 2.2.9l1.1-.3a2 2 0 0 1 2.4 2.4l-.3 1.1a2 2 0 0 0 .9 2.2l1 .6a2 2 0 0 1 0 3.4l-1 .6a2 2 0 0 0-.9 2.2l.3 1.1a2 2 0 0 1-2.4 2.4l-1.1-.3a2 2 0 0 0-2.2.9l-.6 1a2 2 0 0 1-3.4 0l-.6-1a2 2 0 0 0-2.2-.9l-1.1.3a2 2 0 0 1-2.4-2.4l.3-1.1a2 2 0 0 0-.9-2.2l-1-.6a2 2 0 0 1 0-3.4l1-.6a2 2 0 0 0 .9-2.2l-.3-1.1a2 2 0 0 1 2.4-2.4l1.1.3a2 2 0 0 0 2.2-.9l.6-1ZM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
