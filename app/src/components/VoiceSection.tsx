/**
 * Section « Salons vocaux » de la barre latérale d'un groupe : entrée du salon
 * vocal par défaut (convention UI : channel_id == group_id) et, dessous, la
 * liste des participants connectés — anneau vert autour de l'avatar quand la
 * personne parle, badges micro/son coupé (états diffusés par les pairs) et
 * curseur de volume par participant distant, à la Discord.
 */

import { useEffect, useState } from 'react';
import { interpolate } from '../i18n';
import { rpc } from '../lib/client';
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

/** Icône micro barré (participant muet), 14 px, à la Discord. */
function MicOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15 10.6V5a3 3 0 0 0-5.9-.8L15 10.1v.5ZM9 9.9V11a3 3 0 0 0 4.6 2.5l1.5 1.5A5 5 0 0 1 7 11v-1l2-.1Z" />
      <path d="M18 11a6 6 0 0 1-.7 2.8l1.5 1.5A8 8 0 0 0 20 11h-2ZM6 11c0 3.1 2.4 5.7 5.5 6v2H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2.5v-2c1-.1 2-.5 2.8-1l-1.5-1.5A6 6 0 0 1 6 11H4a8 8 0 0 0 .2 1.8L6 11Z" />
      <path d="M3.7 2.3a1 1 0 0 0-1.4 1.4l18 18a1 1 0 0 0 1.4-1.4l-18-18Z" />
    </svg>
  );
}

/** Icône casque barré (participant sourd), 14 px, à la Discord. */
function HeadphonesOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 4a7 7 0 0 0-6.6 4.7L3.9 7.2A9 9 0 0 1 21 12v5a2 2 0 0 1-.4 1.2L19 16.6V12a7 7 0 0 0-7-8Z" />
      <path d="M3 12c0-.6.1-1.2.2-1.8L5 12v1h-.9a1 1 0 0 0-1 1H3v-2Zm2 3.4V19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2h-.6L5 15.4ZM16 14.4l5 5V19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3c0-.2 0-.4.1-.6h-.1Z" />
      <path d="M3.7 2.3a1 1 0 0 0-1.4 1.4l18 18a1 1 0 0 0 1.4-1.4l-18-18Z" />
    </svg>
  );
}

/**
 * Rangée d'un participant : avatar (anneau vert en parole), pseudo, badges
 * micro/son coupé et — pour les participants distants — un bouton qui déplie
 * un curseur de volume local (0-200 %, persisté côté nœud).
 */
function ParticipantRow({
  pubkey,
  state,
  name,
  isSelf,
}: {
  pubkey: string;
  state: ParticipantState;
  name: string;
  isSelf: boolean;
}) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const setVolume = useVoice((s) => s.setVolume);
  const [showVolume, setShowVolume] = useState(false);

  const onVolume = (value: number) => {
    setVolume(pubkey, value).catch(() => toast('error', t.errors.actionFailed));
  };

  return (
    <li className="group rounded px-2 py-1 text-muted">
      <div className="flex items-center gap-2">
        <div
          className={`shrink-0 rounded-full ${state.speaking ? 'ring-2 ring-green' : ''}`}
        >
          <Avatar id={pubkey} name={name} size={24} />
        </div>
        {state.speaking && <span className="sr-only">{t.voice.speaking}</span>}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        {state.muted && (
          <span role="img" aria-label={t.voice.mutedBadge} className="shrink-0 text-red">
            <MicOffIcon />
          </span>
        )}
        {state.deafened && (
          <span
            role="img"
            aria-label={t.voice.deafenedBadge}
            className="shrink-0 text-red"
          >
            <HeadphonesOffIcon />
          </span>
        )}
        {!isSelf && (
          <button
            type="button"
            aria-expanded={showVolume}
            aria-label={interpolate(t.voice.adjustVolumeOf, { name })}
            onClick={() => setShowVolume((v) => !v)}
            className={`shrink-0 rounded px-1 text-xs text-faint transition-opacity duration-150 hover:text-norm focus-visible:opacity-100 group-hover:opacity-100 ${
              showVolume ? 'opacity-100 text-norm' : 'opacity-0'
            }`}
          >
            {state.volume}%
          </button>
        )}
      </div>
      {!isSelf && showVolume && (
        <div className="flex items-center gap-2 pb-1 pl-8 pr-1 pt-1">
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={state.volume}
            aria-label={interpolate(t.voice.volumeOf, { name })}
            onChange={(e) => onVolume(Number(e.target.value))}
            className="h-1 w-full accent-blurple"
          />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-faint">
            {state.volume}%
          </span>
        </div>
      )}
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

  // Les états micro/son des pairs changent sans re-jointure : on applique
  // `event.voice_mute` au store tant que la section est montée…
  useEffect(() => {
    return rpc.onEvent((method, params) => {
      if (method !== 'event.voice_mute') return;
      const p = params as { pubkey?: unknown; muted?: unknown; deafened?: unknown };
      if (
        typeof p.pubkey !== 'string' ||
        typeof p.muted !== 'boolean' ||
        typeof p.deafened !== 'boolean'
      ) {
        return;
      }
      useVoice
        .getState()
        .applyMuteState({ pubkey: p.pubkey, muted: p.muted, deafened: p.deafened });
    });
  }, []);

  // … et on resynchronise à la connexion (volumes persistés, états courants),
  // au cas où des événements auraient été manqués section démontée.
  useEffect(() => {
    if (!isConnectedHere) return;
    useVoice
      .getState()
      .sync()
      .catch(() => {
        // Best effort : l'affichage se corrige aux prochains événements.
      });
  }, [isConnectedHere]);

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
              isSelf={self !== null && pubkey === self.pubkey}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
