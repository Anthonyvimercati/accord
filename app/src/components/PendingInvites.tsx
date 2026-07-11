/**
 * Invitations de serveur reçues (consentement explicite, D-045 : plus de
 * force-join) : nom du serveur (déjà assaini côté nœud, échappé par React de
 * toute façon), qui a invité, actions Accepter/Refuser. Alimentée par
 * `useGroups.pendingInvites` (chargée au démarrage, complétée par
 * `event.group_invite_pending` — voir `AppShell`). Rendue dans l'onglet
 * « Invitations » de `FriendsView`.
 */

import { interpolate } from '../i18n';
import type { PendingInvite } from '../lib/api';
import { avatarOf, displayNameOf, useFriends } from '../stores/friends';
import { useGroups } from '../stores/groups';
import { useT, useUi } from '../stores/ui';
import { Avatar } from './Avatar';

function InviteRow({ invite }: { invite: PendingInvite }) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const contacts = useFriends((s) => s.contacts);
  const acceptInvite = useGroups((s) => s.acceptInvite);
  const declineInvite = useGroups((s) => s.declineInvite);

  const inviterName = displayNameOf(contacts, invite.inviter);

  const act = (fn: () => Promise<void>): void => {
    void fn().catch(() => toast('error', t.errors.actionFailed));
  };

  return (
    <div className="flex h-11 items-center gap-3 rounded-lg px-3 transition-colors duration-fast hover:bg-chat-hover">
      <Avatar
        id={invite.inviter}
        name={inviterName}
        size={32}
        avatarHash={avatarOf(contacts, invite.inviter)}
        hint={invite.inviter}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-header">{invite.group_name}</div>
        <div className="truncate text-xs text-faint">
          {interpolate(t.invitations.invitedBy, { name: inviterName })}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => act(() => acceptInvite(invite.group_id, invite.invite_id))}
          className="rounded-sm bg-blurple px-3 py-1.5 text-sm font-medium text-white transition-colors duration-fast hover:bg-blurple-hover active:scale-95"
        >
          {t.invitations.accept}
        </button>
        <button
          type="button"
          onClick={() => act(() => declineInvite(invite.group_id, invite.invite_id))}
          className="rounded-sm bg-sidebar px-3 py-1.5 text-sm font-medium text-norm transition-colors duration-fast hover:bg-input active:scale-95"
        >
          {t.invitations.decline}
        </button>
      </div>
    </div>
  );
}

export function PendingInvites() {
  const t = useT();
  const invites = useGroups((s) => s.pendingInvites);

  if (invites.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center text-muted">
        <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-full bg-sidebar text-faint">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9a2.5 2.5 0 0 1-2.5 2.5H9.4l-4 3a.9.9 0 0 1-1.4-.7V5.5Z" />
          </svg>
        </span>
        <p>{t.invitations.empty}</p>
      </div>
    );
  }

  return (
    <div>
      {invites.map((invite) => (
        <InviteRow key={`${invite.group_id}/${invite.invite_id}`} invite={invite} />
      ))}
    </div>
  );
}
