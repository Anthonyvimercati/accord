/** Vue conversation : MP (deux personnes) ou salon de groupe + membres. */

import { useEffect, useRef, useState } from 'react';
import '../styles/chat-polish.css';
import { interpolate } from '../i18n';
import type { Contact, SelfProfile } from '../lib/api';
import { bouclerTab } from '../lib/focus';
import { useCalls } from '../stores/calls';
import { useContextMenu } from '../stores/contextMenu';
import { useDms } from '../stores/dms';
import {
  useFriends,
  avatarDecorationOf,
  avatarOf,
  displayNameOf,
  presenceOf,
} from '../stores/friends';
import {
  useGroups,
  aggregateEmojiMap,
  channelKey,
  channelThreads,
  hasPerm,
  memberColor,
  myChannelPermissions,
  nicknameOf,
  threadOfRoot,
  PERMISSIONS,
} from '../stores/groups';
import { selfDisplayName, useSession } from '../stores/session';
import { dmTypingKey, groupTypingKey } from '../stores/typing';
import {
  useUi,
  useT,
  type JumpRequest,
  MEMBERS_WIDTH_DEFAULT,
  MEMBERS_WIDTH_MIN,
  MEMBERS_WIDTH_MAX,
} from '../stores/ui';
import { Avatar } from './Avatar';
import { buildContactMenu } from './contactMenu';
import { CloseIcon, PhoneIcon } from './ContextMenu';
import { MemberList } from './chat/MemberList';
import { PinnedPanel, SelectionBar, ThreadsListPanel, PURGE_MAX } from './chat/panels';
import { MessageInput } from './MessageInput';
import { MessageList, type DisplayMessage } from './MessageList';
import { deliveryOf, displayText } from './messageModel';
import { ForumView } from './ForumView';
import { ResizeHandle } from './ResizeHandle';
import { ThreadPanel } from './ThreadPanel';
import { TypingIndicator } from './TypingIndicator';

/**
 * Traite la demande de saut de l'UI qui vise la vue courante : charge la
 * fenêtre du message (via `load`) puis rend la cible à révéler (défilement +
 * surbrillance dans `MessageList`). Une cible absente déclenche un toast.
 */
function useMessageJump(
  matches: (jump: JumpRequest) => boolean,
  load: (msgId: string) => Promise<boolean>,
): { msgId: string; nonce: number } | null {
  const jump = useUi((s) => s.jump);
  const clearJump = useUi((s) => s.clearJump);
  const toast = useUi((s) => s.toast);
  const t = useT();
  const [scrollTarget, setScrollTarget] = useState<{
    msgId: string;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    if (jump === null || !matches(jump)) return;
    const req = jump;
    let cancelled = false;
    void (async () => {
      let found = false;
      try {
        found = await load(req.msgId);
      } catch {
        found = false;
      }
      if (cancelled) return;
      if (found) setScrollTarget({ msgId: req.msgId, nonce: req.nonce });
      else toast('error', t.dm.messageUnavailable);
      clearJump();
    })();
    return () => {
      cancelled = true;
    };
    // `matches`/`load` capturent la vue courante ; seul un nouveau saut relance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  return scrollTarget;
}

/** Messages épinglés résolus dans l'historique chargé + nombre hors-page. */
function resolvePins(
  pinnedIds: readonly string[],
  messages: readonly DisplayMessage[],
): { resolved: DisplayMessage[]; unresolved: number } {
  const byId = new Map(messages.map((m) => [m.msg_id, m]));
  const resolved = pinnedIds.flatMap((id) => {
    const message = byId.get(id);
    return message !== undefined && !message.deleted ? [message] : [];
  });
  return { resolved, unresolved: pinnedIds.length - resolved.length };
}

/** Noms (en minuscules) reconnus comme mentions : contacts nommés + soi-même. */
function mentionSet(contacts: Contact[], self: SelfProfile | null): Set<string> {
  const noms = new Set<string>();
  for (const c of contacts) {
    if (c.display_name.trim() !== '') noms.add(c.display_name.toLowerCase());
  }
  if (self !== null) noms.add(selfDisplayName(self).toLowerCase());
  return noms;
}

/** Longueur maximale d'un nom de fil dérivé du texte du message racine. */
const THREAD_NAME_MAX = 50;

/**
 * Nom de fil par défaut : début de la première ligne du message racine (tronqué),
 * ou `fallback` si le message n'a pas de texte exploitable.
 */
function deriveThreadName(text: string, fallback: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  if (firstLine === '') return fallback;
  return firstLine.length > THREAD_NAME_MAX
    ? `${firstLine.slice(0, THREAD_NAME_MAX).trimEnd()}…`
    : firstLine;
}

/** Bouton d'action de l'en-tête de conversation : conteneur carré fixe (icon spec). */
function HeaderIconButton({
  label,
  active,
  onClick,
  ariaExpanded,
  buttonRef,
  disabled = false,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  ariaExpanded?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={ariaExpanded}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors duration-fast hover:bg-chat-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-chat active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
        active ? 'text-header' : 'text-muted hover:text-norm'
      }`}
    >
      {children}
    </button>
  );
}

/** Bandeau « Répondre à … » au-dessus de la zone de saisie, annulable. */
function ReplyBanner({ name, onCancel }: { name: string; onCancel: () => void }) {
  const t = useT();
  // Le nom est mis en gras quelle que soit sa position dans le libellé.
  const [before, after] = t.dm.replyingTo.split('{name}');
  return (
    <div className="relative z-[1] mx-4 -mb-1 flex items-center justify-between gap-2 rounded-t-xl border border-b-0 border-rail/60 bg-sidebar px-4 py-2 text-sm">
      <span className="min-w-0 truncate text-muted">
        {before}
        <span className="font-semibold text-header">{name}</span>
        {after}
      </span>
      <button
        type="button"
        aria-label={t.dm.cancelReply}
        title={t.dm.cancelReply}
        onClick={onCancel}
        className="flex shrink-0 items-center justify-center rounded-full p-1 text-faint transition-colors duration-fast hover:text-norm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar active:scale-90"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

export function DmView({ peer }: { peer: string }) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const contacts = useFriends((s) => s.contacts);
  const self = useSession((s) => s.self);
  const callPhase = useCalls((s) => s.phase);
  const callPeer = useCalls((s) => s.peer);
  const startCall = useCalls((s) => s.start);
  const clearMissed = useCalls((s) => s.clearMissed);
  const messages = useDms((s) => s.conversations[peer]) ?? [];
  const hasMore = useDms((s) => s.hasMore[peer]) === true;
  const refresh = useDms((s) => s.refresh);
  const loadOlder = useDms((s) => s.loadOlder);
  const send = useDms((s) => s.send);
  const edit = useDms((s) => s.edit);
  const deleteMessage = useDms((s) => s.deleteMessage);
  const toggleReaction = useDms((s) => s.toggleReaction);
  const pins = useDms((s) => s.pins[peer]) ?? [];
  const loadPins = useDms((s) => s.loadPins);
  const togglePin = useDms((s) => s.togglePin);
  const retry = useDms((s) => s.retry);
  const markRead = useFriends((s) => s.markRead);
  const requestJump = useUi((s) => s.requestJump);
  // Serveurs rejoints par le membre local, pour l'agrégat d'émojis custom
  // (aucun `groupId` de contexte en MP — voir `emojiMap` ci-dessous).
  const groupIds = useGroups((s) => s.ids);
  const groupStates = useGroups((s) => s.states);
  const name = displayNameOf(contacts, peer);
  /** Volet des messages épinglés (fermé par défaut). */
  const [pinsOpen, setPinsOpen] = useState(false);
  /** Message auquel la prochaine saisie répondra (null : envoi simple). */
  const [replyTo, setReplyTo] = useState<DisplayMessage | null>(null);
  /**
   * Position lue figée à l'ouverture du MP (séparateur « nouveaux messages ») :
   * capturée AVANT que markRead ne la fasse avancer. `null` = pas de séparateur.
   */
  const [dividerLamport, setDividerLamport] = useState<number | null>(null);
  /** Lamport du dernier message affiché (`null` : fil vide). */
  const lastLamport = messages.at(-1)?.lamport ?? null;

  const scrollTarget = useMessageJump(
    (jump) => jump.view.kind === 'dm' && jump.view.peer === peer,
    (msgId) => useDms.getState().jumpTo(peer, msgId),
  );

  useEffect(() => {
    setPinsOpen(false);
    setReplyTo(null);
    // Un saut vers cette conversation charge lui-même la fenêtre du message
    // ciblé : on évite alors le rechargement récent qui l'écraserait.
    const jump = useUi.getState().jump;
    const jumpingHere = jump?.view.kind === 'dm' && jump.view.peer === peer;
    if (!jumpingHere) {
      refresh(peer).catch(() => toast('error', t.errors.loadFailed));
    }
    // Épinglés en best effort : le volet affichera ce qui est connu.
    loadPins(peer).catch(() => {});
  }, [peer, refresh, loadPins, toast, t]);

  // Conversation ouverte : efface le badge d'appel manqué de ce pair, le cas
  // échéant (voir `stores/calls.ts`).
  useEffect(() => {
    clearMissed(peer);
  }, [peer, clearMissed]);

  // Capture one-shot de la position lue à l'ouverture (dépend de `peer` seul) :
  // lue depuis le store AVANT le markRead ci-dessous, elle fige le séparateur.
  // markRead avance la marque via `friends.load`, mais cet effet ne se rejoue
  // pas (deps inchangées) — le séparateur reste à la position d'entrée.
  useEffect(() => {
    const c = useFriends.getState().contacts.find((x) => x.pubkey === peer);
    setDividerLamport(c?.read_lamport ?? null);
  }, [peer]);

  // Conversation affichée : marquée lue jusqu'au dernier message connu, à
  // l'ouverture comme à chaque arrivée — le badge de non-lus retombe. Seule
  // la conversation montrée est concernée (le composant est démonté sinon).
  useEffect(() => {
    if (lastLamport === null) return;
    markRead(peer, lastLamport).catch(() => {
      // Best effort : les compteurs seront corrigés au prochain passage.
    });
  }, [peer, lastLamport, markRead]);

  const onActionError = (): void => toast('error', t.errors.actionFailed);
  const knownMentions = mentionSet(contacts, self);
  const pinnedIds = new Set(pins);
  const nameOf = (author: string): string =>
    self && author === self.pubkey
      ? `${selfDisplayName(self)}`
      : displayNameOf(contacts, author);
  const { resolved: resolvedPins, unresolved: unresolvedPins } = resolvePins(
    pins,
    messages,
  );
  // Aucun serveur de contexte en MP : les émojis custom viennent de l'agrégat
  // de tous les serveurs rejoints (voir `aggregateEmojiMap`) — l'image reste
  // chargée par sa racine Merkle, indépendante du groupe. Repli en texte
  // `:name:` si l'émoji n'appartient à aucun serveur du destinataire.
  const emojiMap = aggregateEmojiMap(groupIds, groupStates);

  const ouvrirProfil = (target: HTMLElement): void => {
    const r = target.getBoundingClientRect();
    useUi.getState().openProfile(peer, {
      top: r.top,
      left: r.left,
      bottom: r.bottom,
      right: r.right,
    });
  };

  // Appel 1-à-1 : réservé aux amis confirmés (contrat calls.start) ; le
  // bouton est simplement absent sinon plutôt qu'un état désactivé confus.
  const isFriend = contacts.some((c) => c.pubkey === peer && c.state === 'friend');
  // Boîte chiffrée : pair hors ligne ET au moins un message local encore
  // `pending` ⇒ bandeau discret en tête de fil — les envois sont déposés dans
  // la boîte du destinataire (expiration 7 j côté nœud), pas perdus.
  const peerOffline = presenceOf(contacts.find((c) => c.pubkey === peer)) === 'offline';
  const hasPendingLocal =
    self !== null &&
    messages.some((m) => m.author === self.pubkey && deliveryOf(m) === 'pending');
  const callOngoing = callPhase !== 'idle';
  const inCallWithPeer = callPhase === 'active' && callPeer === peer;
  const onStartCall = (): void => {
    if (callOngoing) return;
    startCall(peer).catch(onActionError);
  };

  return (
    <div className="accord-conversation relative flex h-full flex-col">
      <header className="accord-chat-header flex h-12 shrink-0 items-center gap-3 border-b border-[color:var(--glass-border)] bg-chat/90 px-4 shadow-1">
        <button
          type="button"
          aria-label={interpolate(t.profil.openProfile, { name })}
          onClick={(e) => ouvrirProfil(e.currentTarget)}
          onContextMenu={(e) => {
            const contact = contacts.find((c) => c.pubkey === peer);
            if (contact === undefined) return;
            e.preventDefault();
            useContextMenu
              .getState()
              .openMenu(
                e.clientX,
                e.clientY,
                buildContactMenu(t, contact, e.currentTarget),
              );
          }}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-0.5 text-left transition-colors duration-fast hover:bg-chat-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-chat"
        >
          <Avatar
            id={peer}
            name={name}
            size={26}
            avatarHash={avatarOf(contacts, peer)}
            hint={peer}
            decoration={avatarDecorationOf(contacts, peer)}
            online={
              contacts.some((c) => c.pubkey === peer && c.state === 'friend')
                ? (contacts.find((c) => c.pubkey === peer)?.online ?? false)
                : undefined
            }
          />
          <span className="min-w-0 truncate font-semibold text-header" title={name}>
            {name}
          </span>
          {inCallWithPeer && (
            <span className="rounded-full bg-green/15 px-2 py-0.5 text-xs font-medium text-green">
              {t.calls.inCall}
            </span>
          )}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isFriend && (
            <HeaderIconButton
              label={callOngoing ? t.calls.callAlreadyOngoing : t.calls.startCall}
              active={false}
              disabled={callOngoing}
              onClick={onStartCall}
            >
              <PhoneIcon />
            </HeaderIconButton>
          )}
          <HeaderIconButton
            label={t.serveur.pinnedTitle}
            active={pinsOpen}
            ariaExpanded={pinsOpen}
            onClick={() => setPinsOpen((open) => !open)}
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
              <line x1="12" x2="12" y1="17" y2="22" />
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
            </svg>
          </HeaderIconButton>
        </div>
      </header>
      {pinsOpen && (
        <PinnedPanel
          resolved={resolvedPins}
          unresolved={unresolvedPins}
          canUnpin
          onUnpin={(msgId) => {
            togglePin(peer, msgId, true).catch(onActionError);
          }}
          onJump={(msgId) => {
            setPinsOpen(false);
            requestJump({ kind: 'dm', peer }, msgId);
          }}
          onClose={() => setPinsOpen(false)}
          nameOf={nameOf}
        />
      )}
      {peerOffline && hasPendingLocal && (
        <div className="px-4 pt-2">
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-xl bg-input px-4 py-2.5 text-sm text-muted"
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
              className="shrink-0"
            >
              <path d="M22 17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5C2 7 4 5 6.5 5H18a4 4 0 0 1 4 4Z" />
              <polyline points="15,9 18,9 18,11" />
              <path d="M6.5 5C9 5 11 7 11 9.5V17a2 2 0 0 1-2 2" />
              <line x1="6" x2="7" y1="10" y2="10" />
            </svg>
            <span>{interpolate(t.dm.mailboxBanner, { name })}</span>
          </div>
        </div>
      )}
      <MessageList
        key={peer}
        messages={messages}
        hasMore={hasMore}
        scrollTarget={scrollTarget}
        dividerLamport={dividerLamport}
        pinnedIds={pinnedIds}
        knownMentions={knownMentions}
        emojiMap={emojiMap}
        onLoadOlder={() => {
          loadOlder(peer).catch(() => toast('error', t.errors.loadFailed));
        }}
        actions={{
          onReact: (message, emoji) => {
            if (!self) return;
            toggleReaction(peer, message.msg_id, emoji, self.pubkey).catch(onActionError);
          },
          onReply: (message) => setReplyTo(message),
          onEdit: (message, text) => {
            edit(peer, message.msg_id, text).catch(onActionError);
          },
          onDelete: (message) => {
            deleteMessage(peer, message.msg_id).catch(onActionError);
          },
          onTogglePin: (message, pinned) => {
            togglePin(peer, message.msg_id, pinned).catch(onActionError);
          },
          onRetry: (message) => {
            retry(peer, message.msg_id).catch(onActionError);
          },
        }}
      />
      {replyTo !== null && (
        <ReplyBanner
          name={
            self && replyTo.author === self.pubkey
              ? `${selfDisplayName(self)}`
              : displayNameOf(contacts, replyTo.author)
          }
          onCancel={() => setReplyTo(null)}
        />
      )}
      <TypingIndicator typingKey={dmTypingKey(peer)} />
      <MessageInput
        placeholder={interpolate(t.dm.placeholder, { name })}
        typingTarget={{ kind: 'dm', peer }}
        focusKey={replyTo?.msg_id ?? null}
        onSend={async (text, attachments) => {
          await send(peer, text, replyTo?.msg_id, attachments);
          setReplyTo(null);
        }}
      />
    </div>
  );
}

export function GroupView({
  groupId,
  channelId,
}: {
  groupId: string;
  channelId: string | null;
}) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const self = useSession((s) => s.self);
  const contacts = useFriends((s) => s.contacts);
  const state = useGroups((s) => s.states[groupId]);
  const membersWidth = useUi((s) => s.membersWidth);
  const setMembersWidth = useUi((s) => s.setMembersWidth);
  const key = channelId === null ? null : channelKey(groupId, channelId);
  const messages = useGroups((s) => (key === null ? undefined : s.messages[key])) ?? [];
  const hasMore = useGroups((s) => (key === null ? false : s.hasMore[key])) === true;
  const pins = useGroups((s) => (key === null ? undefined : s.pins[key]));
  const refreshHistory = useGroups((s) => s.refreshHistory);
  const loadOlderHistory = useGroups((s) => s.loadOlderHistory);
  const loadPins = useGroups((s) => s.loadPins);
  const send = useGroups((s) => s.send);
  const editMessage = useGroups((s) => s.editMessage);
  const deleteMessage = useGroups((s) => s.deleteMessage);
  const toggleReaction = useGroups((s) => s.toggleReaction);
  const togglePin = useGroups((s) => s.togglePin);
  const createThread = useGroups((s) => s.createThread);
  const markRead = useGroups((s) => s.markRead);
  const purge = useGroups((s) => s.purge);
  const requestJump = useUi((s) => s.requestJump);
  /** Volet des messages épinglés (fermé par défaut). */
  const [pinsOpen, setPinsOpen] = useState(false);
  /** Popover de la liste des fils du salon (fermé par défaut). */
  const [threadsListOpen, setThreadsListOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const membersButtonRef = useRef<HTMLButtonElement>(null);
  /** Fil ouvert dans le panneau latéral (`null` : aucun). */
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  /** Message auquel la prochaine saisie répondra (null : envoi simple). */
  const [replyTo, setReplyTo] = useState<DisplayMessage | null>(null);
  /**
   * Position lue figée à l'ouverture du salon (séparateur « nouveaux
   * messages ») : capturée AVANT que markRead ne la fasse avancer.
   */
  const [dividerLamport, setDividerLamport] = useState<number | null>(null);
  /** Mode sélection de messages actif (suppression groupée par modérateur). */
  const [selecting, setSelecting] = useState(false);
  /** Messages cochés dans le mode sélection (identité locale à `GroupView`). */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  /** Lamport du dernier message affiché (`null` : fil vide). */
  const lastLamport = messages.at(-1)?.lamport ?? null;

  const scrollTarget = useMessageJump(
    (jump) =>
      jump.view.kind === 'group' &&
      jump.view.groupId === groupId &&
      jump.view.channelId === channelId,
    (msgId) =>
      channelId === null
        ? Promise.resolve(false)
        : useGroups.getState().jumpTo(groupId, channelId, msgId),
  );

  const channel = state?.channels.find((c) => c.channel_id === channelId);
  const canModerate = hasPerm(state?.my_permissions ?? 0, PERMISSIONS.MANAGE_MESSAGES);
  const closeMembers = (): void => {
    setMembersOpen(false);
    membersButtonRef.current?.focus();
  };

  useEffect(() => {
    setPinsOpen(false);
    setThreadsListOpen(false);
    setMembersOpen(false);
    setOpenThreadId(null);
    setReplyTo(null);
    setSelecting(false);
    setSelectedIds(new Set());
    if (channelId !== null) {
      // Un saut vers ce salon charge lui-même la fenêtre du message ciblé :
      // on évite alors le rechargement récent qui l'écraserait.
      const jump = useUi.getState().jump;
      const jumpingHere =
        jump?.view.kind === 'group' &&
        jump.view.groupId === groupId &&
        jump.view.channelId === channelId;
      if (!jumpingHere) {
        refreshHistory(groupId, channelId).catch(() =>
          toast('error', t.errors.loadFailed),
        );
      }
      // Épinglés en best effort : le volet affichera ce qui est connu.
      loadPins(groupId, channelId).catch(() => {});
    }
  }, [groupId, channelId, refreshHistory, loadPins, toast, t]);

  // Capture one-shot de la position lue du salon à l'ouverture (dépend de
  // [groupId, channelId]) : lue depuis le store AVANT le markRead ci-dessous.
  // markRead ne touche pas `states.read_marks` (il ne rafraîchit que les
  // compteurs), et cet effet ne se rejoue pas — le séparateur reste figé.
  useEffect(() => {
    if (channelId === null) {
      setDividerLamport(null);
      return;
    }
    const marks = useGroups.getState().states[groupId]?.read_marks;
    setDividerLamport(marks?.[channelId] ?? null);
  }, [groupId, channelId]);

  // Mode sélection : Échap le referme (comme les autres volets), au niveau
  // fenêtre pour capter la touche hors focus d'un champ de saisie.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setSelecting(false);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  // Salon affiché : marqué lu jusqu'au dernier message connu, à l'ouverture
  // comme à chaque arrivée — le badge de non-lus du salon retombe.
  useEffect(() => {
    if (channelId === null || lastLamport === null) return;
    markRead(groupId, channelId, lastLamport).catch(() => {
      // Best effort : les compteurs seront corrigés au prochain passage.
    });
  }, [groupId, channelId, lastLamport, markRead]);

  if (channelId === null || !channel) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        {t.groups.noChannel}
      </div>
    );
  }

  const onActionError = (): void => toast('error', t.errors.actionFailed);
  const pinnedIds = new Set(pins ?? []);

  /** Coche/décoche un message dans le mode sélection (état local immuable). */
  const toggleSelected = (msgId: string): void =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });

  /** Quitte le mode sélection en vidant la sélection. */
  const exitSelection = (): void => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  /** Suppression groupée des messages cochés (bornée à 100 côté nœud). */
  const purgeSelected = (): void => {
    const ids = [...selectedIds];
    if (ids.length === 0 || ids.length > PURGE_MAX) return;
    purge(groupId, channelId, ids).then(exitSelection).catch(onActionError);
  };

  // AutoMod du serveur : mots masqués au rendu du fil et avertissement
  // émetteur dans le composeur (jamais transmis en MP).
  const automodWords = state?.automod_words ?? [];

  // Mode lent : échéance murale du prochain envoi permis — reproduit la règle
  // d'exemption du nœud (`slowmode_exempt` : MANAGE_CHANNELS ou
  // MANAGE_MESSAGES effectif dans le salon) à partir du dernier message de
  // l'utilisateur courant dans l'historique chargé. `null` = aucune
  // contrainte active ; le composeur tient lui-même le compte à rebours.
  const slowmodeSecs = channel.slowmode_secs ?? 0;
  let slowmodeUntilMs: number | null = null;
  if (slowmodeSecs > 0 && state !== undefined && self !== null) {
    const eff = myChannelPermissions(state, channelId, self.pubkey);
    const exempt =
      hasPerm(eff, PERMISSIONS.MANAGE_CHANNELS) ||
      hasPerm(eff, PERMISSIONS.MANAGE_MESSAGES);
    if (!exempt) {
      let lastOwnMs: number | null = null;
      for (const m of messages) {
        if (m.author === self.pubkey) lastOwnMs = m.sent_ms;
      }
      if (lastOwnMs !== null) {
        const until = lastOwnMs + slowmodeSecs * 1000;
        slowmodeUntilMs = until > Date.now() ? until : null;
      }
    }
  }

  const colorOf = (author: string): string | null =>
    state === undefined
      ? null
      : memberColor(
          state.members.find((m) => m.pubkey === author),
          state.roles,
        );
  const emojiMap = new Map(
    (state?.emojis ?? []).map((e) => [e.name, e.merkle_root] as const),
  );
  const knownMentions = mentionSet(contacts, self);
  for (const m of state?.members ?? []) {
    knownMentions.add(displayNameOf(contacts, m.pubkey).toLowerCase());
  }
  const nameOf = (author: string): string => {
    const nick = nicknameOf(state, author);
    if (self && author === self.pubkey) {
      return `${nick ?? selfDisplayName(self)}`;
    }
    return nick ?? displayNameOf(contacts, author);
  };
  const { resolved: resolvedPins, unresolved: unresolvedPins } = resolvePins(
    pins ?? [],
    messages,
  );

  // Fils du salon courant : liste du popover, pastilles de racine, décision
  // « Créer » vs « Ouvrir » du menu, et panneau latéral.
  const channelThreadList = channelThreads(state, channelId);
  const canManageThreads =
    state !== undefined &&
    self !== null &&
    hasPerm(
      myChannelPermissions(state, channelId, self.pubkey),
      PERMISSIONS.MANAGE_CHANNELS,
    );
  const openThread =
    openThreadId === null
      ? null
      : ((state?.threads ?? []).find((th) => th.thread_id === openThreadId) ?? null);
  const openThreadRoot =
    openThread === null
      ? undefined
      : messages.find((m) => m.msg_id === openThread.root_msg);

  /** Ouvre le fil ancré sur ce message, en le créant d'abord si nécessaire. */
  const onOpenThread = (message: DisplayMessage): void => {
    const existing = threadOfRoot(state, message.msg_id);
    if (existing !== undefined) {
      setThreadsListOpen(false);
      setOpenThreadId(existing.thread_id);
      return;
    }
    const name = deriveThreadName(displayText(message) ?? '', t.threads.newThreadName);
    createThread(groupId, channelId, message.msg_id, name)
      .then((threadId) => {
        setThreadsListOpen(false);
        setOpenThreadId(threadId);
      })
      .catch(onActionError);
  };

  // Salon FORUM : ses « posts » sont des fils (le nœud refuse tout message
  // direct dans la racine du forum). On rend la vue forum dédiée à la place du
  // composeur/liste de messages classiques.
  if (channel.kind === 'forum') {
    const canPost =
      state !== undefined &&
      self !== null &&
      hasPerm(
        myChannelPermissions(state, channelId, self.pubkey),
        PERMISSIONS.VIEW | PERMISSIONS.SEND,
      );
    return (
      <ForumView
        groupId={groupId}
        channel={channel}
        posts={channelThreadList}
        canManage={canManageThreads}
        canModerate={canModerate}
        canPost={canPost}
        colorOf={colorOf}
        emojiMap={emojiMap}
        knownMentions={knownMentions}
        automodWords={automodWords}
        nameOf={nameOf}
      />
    );
  }

  return (
    <div
      className={`group-chat-layout accord-conversation relative flex h-full min-w-0 overflow-hidden ${
        openThread !== null ? 'thread-is-open' : ''
      }`}
    >
      <div className="group-chat-main relative flex min-w-0 flex-1 flex-col">
        <header className="accord-chat-header flex h-12 shrink-0 items-center gap-2 border-b border-[color:var(--glass-border)] bg-chat/90 px-4 shadow-1">
          <span
            aria-hidden
            className="flex h-5 w-5 shrink-0 items-center justify-center text-[19px] font-medium leading-none text-faint"
          >
            #
          </span>
          <span
            className="min-w-0 truncate font-semibold text-header"
            title={channel.name}
          >
            {channel.name}
          </span>
          {channel.topic !== '' && (
            <>
              <span aria-hidden className="h-5 w-px shrink-0 bg-input" />
              <span className="min-w-0 truncate text-sm text-muted" title={channel.topic}>
                {channel.topic}
              </span>
            </>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <span className="group-chat-members-toggle">
              <HeaderIconButton
                label={t.groups.members}
                active={membersOpen}
                ariaExpanded={membersOpen}
                buttonRef={membersButtonRef}
                onClick={() => setMembersOpen((open) => !open)}
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </HeaderIconButton>
            </span>
            <HeaderIconButton
              label={t.threads.threadsList}
              active={threadsListOpen}
              ariaExpanded={threadsListOpen}
              onClick={() => {
                setPinsOpen(false);
                setThreadsListOpen((open) => !open);
              }}
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
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
              </svg>
            </HeaderIconButton>
            <HeaderIconButton
              label={t.serveur.pinnedTitle}
              active={pinsOpen}
              ariaExpanded={pinsOpen}
              onClick={() => {
                setThreadsListOpen(false);
                setPinsOpen((open) => !open);
              }}
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
                <line x1="12" x2="12" y1="17" y2="22" />
                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
              </svg>
            </HeaderIconButton>
          </div>
        </header>
        {threadsListOpen && (
          <ThreadsListPanel
            threads={channelThreadList}
            onOpen={(threadId) => {
              setThreadsListOpen(false);
              setOpenThreadId(threadId);
            }}
            onClose={() => setThreadsListOpen(false)}
          />
        )}
        {pinsOpen && (
          <PinnedPanel
            resolved={resolvedPins}
            unresolved={unresolvedPins}
            canUnpin={canModerate}
            onUnpin={(msgId) => {
              togglePin(groupId, channelId, msgId, true).catch(onActionError);
            }}
            onJump={(msgId) => {
              setPinsOpen(false);
              requestJump({ kind: 'group', groupId, channelId }, msgId);
            }}
            onClose={() => setPinsOpen(false)}
            nameOf={nameOf}
          />
        )}
        {selecting && (
          <SelectionBar
            count={selectedIds.size}
            onDelete={purgeSelected}
            onCancel={exitSelection}
          />
        )}
        <MessageList
          key={key ?? undefined}
          messages={messages}
          hasMore={hasMore}
          scrollTarget={scrollTarget}
          dividerLamport={dividerLamport}
          onLoadOlder={() => {
            loadOlderHistory(groupId, channelId).catch(() =>
              toast('error', t.errors.loadFailed),
            );
          }}
          actions={{
            onReact: (message, emoji) => {
              if (!self) return;
              toggleReaction(
                groupId,
                channelId,
                message.msg_id,
                emoji,
                self.pubkey,
              ).catch(onActionError);
            },
            onReply: (message) => setReplyTo(message),
            onEdit: (message, text) => {
              editMessage(groupId, channelId, message.msg_id, text).catch(onActionError);
            },
            onDelete: (message) => {
              deleteMessage(groupId, channelId, message.msg_id).catch(onActionError);
            },
            canModerate,
            ...(canModerate
              ? {
                  onTogglePin: (message: DisplayMessage, pinned: boolean) => {
                    togglePin(groupId, channelId, message.msg_id, pinned).catch(
                      onActionError,
                    );
                  },
                }
              : {}),
          }}
          pinnedIds={pinnedIds}
          colorOf={colorOf}
          emojiMap={emojiMap}
          knownMentions={knownMentions}
          automodWords={automodWords}
          groupId={groupId}
          threads={channelThreadList}
          onOpenThread={onOpenThread}
          selection={
            selecting
              ? { active: true, selected: selectedIds, onToggle: toggleSelected }
              : undefined
          }
          onStartSelection={
            canModerate
              ? (message: DisplayMessage) => {
                  setSelecting(true);
                  setSelectedIds(new Set([message.msg_id]));
                }
              : undefined
          }
        />
        {replyTo !== null && (
          <ReplyBanner
            name={
              self && replyTo.author === self.pubkey
                ? `${selfDisplayName(self)}`
                : displayNameOf(contacts, replyTo.author)
            }
            onCancel={() => setReplyTo(null)}
          />
        )}
        <TypingIndicator typingKey={groupTypingKey(groupId, channelId)} nameOf={nameOf} />
        <MessageInput
          placeholder={interpolate(t.groups.channelPlaceholder, { name: channel.name })}
          groupId={groupId}
          typingTarget={{ kind: 'group', groupId, channelId }}
          focusKey={replyTo?.msg_id ?? null}
          automodWords={automodWords}
          slowmodeUntilMs={slowmodeUntilMs}
          onSend={async (text, attachments) => {
            await send(groupId, channelId, text, replyTo?.msg_id, attachments);
            setReplyTo(null);
          }}
        />
      </div>
      {openThread !== null && (
        <ThreadPanel
          groupId={groupId}
          thread={openThread}
          rootMessage={openThreadRoot}
          canManage={canManageThreads}
          canModerate={canModerate}
          colorOf={colorOf}
          emojiMap={emojiMap}
          knownMentions={knownMentions}
          automodWords={automodWords}
          nameOf={nameOf}
          onClose={() => setOpenThreadId(null)}
        />
      )}
      <div className="group-chat-members min-w-0 shrink-0">
        <ResizeHandle
          value={membersWidth}
          min={MEMBERS_WIDTH_MIN}
          max={MEMBERS_WIDTH_MAX}
          defaultValue={MEMBERS_WIDTH_DEFAULT}
          onChange={setMembersWidth}
          ariaLabel={t.layout.resizeMembers}
          panelSide="right"
          ringOffsetClassName="ring-offset-sidebar"
        />
        <MemberList groupId={groupId} />
      </div>
      {membersOpen && (
        <div className="group-chat-members-overlay absolute inset-0 z-30">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t.app.close}
            onClick={closeMembers}
            className="absolute inset-0 cursor-default bg-rail/65 backdrop-blur-[2px]"
          />
          <div
            role="dialog"
            aria-label={t.groups.members}
            aria-modal="true"
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeMembers();
              else bouclerTab(e, e.currentTarget);
            }}
            className="liquid-drawer absolute inset-y-0 right-0 flex max-w-[calc(100vw-48px)] flex-col overflow-hidden border-l"
            style={{ width: membersWidth }}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-[color:var(--glass-border)] px-3">
              <span className="text-sm font-semibold text-header">
                {t.groups.members}
              </span>
              <button
                type="button"
                autoFocus
                aria-label={t.app.close}
                onClick={closeMembers}
                className="flex h-10 w-10 items-center justify-center rounded-md text-muted transition-colors duration-fast hover:bg-chat-hover hover:text-header focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <MemberList groupId={groupId} fill />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
