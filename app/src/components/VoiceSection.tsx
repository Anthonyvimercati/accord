/**
 * Section « Salons vocaux » de la barre latérale d'un groupe : entrée du salon
 * vocal par défaut (convention UI : channel_id == group_id) et, dessous, la
 * liste des participants connectés — anneau vert autour de l'avatar quand la
 * personne parle, à la Discord.
 */

import { displayNameOf, useFriends } from '../stores/friends';
import { selfDisplayName, useSession } from '../stores/session';
import { useUi, useT } from '../stores/ui';
import { useVoice, type ParticipantState } from '../stores/voice';
import { Avatar } from './Avatar';

/** Icône haut-parleur (entrée du salon vocal). */
function SpeakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M11.4 4.1 7 8H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3l4.4 3.9a1 1 0 0 0 1.6-.8V4.9a1 1 0 0 0-1.6-.8Z" />
      <path d="M15.5 8.5a1 1 0 0 1 1.4 0 5 5 0 0 1 0 7 1 1 0 1 1-1.4-1.4 3 3 0 0 0 0-4.2 1 1 0 0 1 0-1.4Z" />
      <path d="M18.3 5.7a1 1 0 0 1 1.4 0 9 9 0 0 1 0 12.7 1 1 0 1 1-1.4-1.4 7 7 0 0 0 0-9.9 1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}

function ParticipantRow({
  pubkey,
  state,
  name,
}: {
  pubkey: string;
  state: ParticipantState;
  name: string;
}) {
  const t = useT();
  return (
    <li className="flex items-center gap-2 rounded px-2 py-1 text-muted">
      <div
        className={`shrink-0 rounded-full ${state.speaking ? 'ring-2 ring-green' : ''}`}
      >
        <Avatar id={pubkey} name={name} size={24} />
      </div>
      {state.speaking && <span className="sr-only">{t.voice.speaking}</span>}
      <span className="truncate text-sm font-medium">{name}</span>
    </li>
  );
}

export function VoiceSection({ groupId }: { groupId: string }) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const active = useVoice((s) => s.active);
  const participants = useVoice((s) => s.participants);
  const join = useVoice((s) => s.join);
  const contacts = useFriends((s) => s.contacts);
  const self = useSession((s) => s.self);

  // Convention UI : un salon vocal par groupe, channel_id == group_id.
  const isConnectedHere =
    active !== null && active.groupId === groupId && active.channelId === groupId;
  const connected = isConnectedHere ? [...participants.entries()] : [];

  const nameOf = (pubkey: string): string =>
    self !== null && pubkey === self.pubkey
      ? selfDisplayName(self)
      : displayNameOf(contacts, pubkey);

  const onJoin = () => {
    if (isConnectedHere) return;
    join(groupId, groupId).catch(() => toast('error', t.errors.actionFailed));
  };

  return (
    <section aria-label={t.voice.channels}>
      <div className="px-2 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-faint">
        {t.voice.channels}
      </div>
      <button
        type="button"
        onClick={onJoin}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 font-medium ${
          isConnectedHere
            ? 'bg-chat-hover text-header'
            : 'text-muted hover:bg-chat-hover hover:text-norm'
        }`}
      >
        <span aria-hidden className="text-faint">
          <SpeakerIcon />
        </span>
        <span className="truncate">{t.voice.defaultChannel}</span>
      </button>
      {connected.length > 0 && (
        <ul className="space-y-0.5 pb-1 pl-6 pr-1 pt-0.5">
          {connected.map(([pubkey, state]) => (
            <ParticipantRow
              key={pubkey}
              pubkey={pubkey}
              state={state}
              name={nameOf(pubkey)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
