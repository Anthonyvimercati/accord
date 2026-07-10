/**
 * Modales : création de groupe/salon, invitation. Les paramètres ouvrent
 * l'écran plein format dédié (components/settings), même déclencheur
 * `ui.modal = { kind: 'settings' }`.
 */

import { useEffect, useRef, useState } from 'react';
import { useFriends, displayNameOf } from '../stores/friends';
import { useGroups } from '../stores/groups';
import { useUi, useT } from '../stores/ui';
import { Avatar } from './Avatar';
import { ServerSettingsModal } from './server/ServerSettingsModal';
import { SettingsModal } from './settings/SettingsModal';

function ModalFrame({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const closeModal = useUi((s) => s.closeModal);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector('input')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [closeModal]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[440px] max-w-[92vw] rounded-lg bg-modal shadow-modal"
      >
        <div className="p-5">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold text-header">{title}</h2>
            <button
              type="button"
              aria-label={t.app.close}
              onClick={closeModal}
              className="text-faint hover:text-norm"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
              >
                <path d="M6.3 5 12 10.6 17.7 5 19 6.3 13.4 12l5.6 5.7-1.3 1.3-5.7-5.6L6.3 19 5 17.7l5.6-5.7L5 6.3 6.3 5Z" />
              </svg>
            </button>
          </div>
          {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function NameForm({
  placeholder,
  action,
  onSubmit,
}: {
  placeholder: string;
  action: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const closeModal = useUi((s) => s.closeModal);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (name.trim() === '' || busy) return;
    setBusy(true);
    try {
      await onSubmit(name.trim());
      closeModal();
    } catch {
      toast('error', t.errors.actionFailed);
      setBusy(false);
    }
  };

  return (
    <>
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        className="w-full rounded bg-rail px-3 py-2.5 text-norm placeholder-faint outline-none"
      />
      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={closeModal}
          className="px-4 py-2 text-sm font-medium text-norm hover:underline"
        >
          {t.app.cancel}
        </button>
        <button
          type="button"
          disabled={name.trim() === '' || busy}
          onClick={() => void submit()}
          className="rounded bg-blurple px-4 py-2 text-sm font-medium text-white hover:bg-blurple-hover disabled:opacity-50"
        >
          {action}
        </button>
      </div>
    </>
  );
}

function CreateGroupModal() {
  const t = useT();
  const create = useGroups((s) => s.create);
  const setView = useUi((s) => s.setView);
  const loadState = useGroups((s) => s.loadState);
  return (
    <ModalFrame title={t.groups.createTitle} hint={t.groups.createHint}>
      <NameForm
        placeholder={t.groups.namePlaceholder}
        action={t.groups.createAction}
        onSubmit={async (name) => {
          const groupId = await create(name, 'général');
          await loadState(groupId);
          const channelId =
            useGroups.getState().states[groupId]?.channels[0]?.channel_id ?? null;
          setView({ kind: 'group', groupId, channelId });
        }}
      />
    </ModalFrame>
  );
}

function CreateChannelModal({ groupId }: { groupId: string }) {
  const t = useT();
  const addChannel = useGroups((s) => s.addChannel);
  const setView = useUi((s) => s.setView);
  return (
    <ModalFrame title={t.groups.addChannel}>
      <NameForm
        placeholder={t.groups.channelNamePlaceholder}
        action={t.groups.addChannelAction}
        onSubmit={async (name) => {
          const channelId = await addChannel(groupId, name);
          setView({ kind: 'group', groupId, channelId });
        }}
      />
    </ModalFrame>
  );
}

function InviteModal({ groupId }: { groupId: string }) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const closeModal = useUi((s) => s.closeModal);
  const contacts = useFriends((s) => s.contacts);
  const state = useGroups((s) => s.states[groupId]);
  const invite = useGroups((s) => s.invite);

  const members = new Set((state?.members ?? []).map((m) => m.pubkey));
  const candidates = contacts.filter(
    (c) => c.state === 'friend' && !members.has(c.pubkey),
  );

  return (
    <ModalFrame title={t.groups.inviteTitle} hint={t.groups.inviteHint}>
      {candidates.length === 0 && (
        <p className="py-4 text-center text-sm text-muted">
          {t.groups.noFriendsToInvite}
        </p>
      )}
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {candidates.map((c) => (
          <div
            key={c.pubkey}
            className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-chat-hover"
          >
            <Avatar
              id={c.pubkey}
              name={displayNameOf(contacts, c.pubkey)}
              size={32}
              avatarHash={c.avatar}
              hint={c.pubkey}
            />
            <span className="min-w-0 flex-1 truncate text-norm">
              {displayNameOf(contacts, c.pubkey)}
            </span>
            <button
              type="button"
              onClick={() => {
                invite(groupId, c.pubkey)
                  .then(() => {
                    toast('info', t.groups.invited);
                    closeModal();
                  })
                  .catch(() => toast('error', t.errors.actionFailed));
              }}
              className="rounded border border-green px-3 py-1 text-sm font-medium text-green hover:bg-green hover:text-white"
            >
              {t.groups.invite}
            </button>
          </div>
        ))}
      </div>
    </ModalFrame>
  );
}

export function Modals() {
  const modal = useUi((s) => s.modal);
  if (modal === null) return null;
  switch (modal.kind) {
    case 'createGroup':
      return <CreateGroupModal />;
    case 'createChannel':
      return <CreateChannelModal groupId={modal.groupId} />;
    case 'invite':
      return <InviteModal groupId={modal.groupId} />;
    case 'settings':
      return <SettingsModal />;
    case 'serverSettings':
      return <ServerSettingsModal groupId={modal.groupId} />;
  }
}
