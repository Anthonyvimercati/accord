/** Coquille principale trois colonnes : rail, barre latérale, contenu. */

import { useCallback, useEffect } from 'react';
import { dictionaries, interpolate } from '../i18n';
import type { AccordEvent } from '../lib/api';
import { rpc } from '../lib/client';
import {
  isNotificationEligible,
  isSoundEligible,
  rememberNotifiedConversation,
  sendNativeNotification,
  takePendingConversation,
  type ConversationRef,
} from '../lib/notifications';
import { playNotificationSound } from '../lib/notificationSound';
import { usePushToTalk } from '../hooks/usePushToTalk';
import { isEditableTarget } from '../stores/contextMenu';
import { useDms } from '../stores/dms';
import { useFriends, displayNameOf } from '../stores/friends';
import { useGroups, channelKey } from '../stores/groups';
import { useSession } from '../stores/session';
import { useTyping, dmTypingKey, groupTypingKey } from '../stores/typing';
import { useUi, useT, type View } from '../stores/ui';
import { useVoice } from '../stores/voice';
import { DmView, GroupView } from './ChatView';
import { ContextMenu } from './ContextMenu';
import { FriendsView } from './FriendsView';
import { Modals } from './Modals';
import { ProfilePopover } from './ProfilePopover';
import { ServerRail } from './ServerRail';
import { Sidebar } from './Sidebar';

/**
 * Notification native « Nouveau message de <nom> » si les réglages
 * l'autorisent — jamais le contenu du message, jamais ses propres messages.
 */
function notifyNewMessage(ref: ConversationRef, author: string): void {
  const self = useSession.getState().self;
  if (self === null) return;
  const ui = useUi.getState();
  const windowFocused = document.hasFocus();
  const eligible = isNotificationEligible({
    kind: ref.kind,
    prefs: {
      dms: ui.notifyDms,
      groups: ui.notifyGroups,
      onlyWhenUnfocused: ui.notifyOnlyUnfocused,
    },
    windowFocused,
    isOwnMessage: author === self.pubkey,
  });
  if (!eligible) return;
  const dict = dictionaries[ui.lang];
  const name = displayNameOf(useFriends.getState().contacts, author);
  void sendNativeNotification(
    dict.app.name,
    interpolate(dict.notifications.newMessageFrom, { name }),
  ).then((sent) => {
    // Notification shown while the window was unfocused: arm navigation on
    // the next focus, so clicking it (which activates the window on macOS
    // and Windows) opens the conversation — see lib/notifications.ts for the
    // per-platform behaviour of the Tauri notification plugin.
    if (sent && !windowFocused) rememberNotifiedConversation(ref);
  });
}

/** Vrai si `ref` désigne la conversation/le salon actuellement affiché. */
function isViewingConversation(view: View, ref: ConversationRef): boolean {
  if (ref.kind === 'dm') return view.kind === 'dm' && view.peer === ref.peer;
  return (
    view.kind === 'group' &&
    view.groupId === ref.groupId &&
    view.channelId === ref.channelId
  );
}

/**
 * Son in-app pour un message entrant : joue sauf pour ses propres messages,
 * en mode Ne pas déranger (statut de présence local, `useFriends.ownStatus`),
 * ou quand la fenêtre a le focus sur exactement cette conversation/ce salon
 * (la pastille de non-lu suffit alors — voir lib/notifications.ts). Une
 * mention (`mentions_me`) joue le blip renforcé.
 */
function maybePlaySound(ref: ConversationRef, author: string, isMention: boolean): void {
  const self = useSession.getState().self;
  if (self === null) return;
  const eligible = isSoundEligible({
    isOwnMessage: author === self.pubkey,
    isDisplayedConversation: isViewingConversation(useUi.getState().view, ref),
    windowFocused: document.hasFocus(),
    dnd: useFriends.getState().ownStatus === 'dnd',
  });
  if (!eligible) return;
  playNotificationSound(isMention ? 'mention' : 'message');
}

/**
 * Notification click fallback: when the window regains focus shortly after a
 * native notification, navigate to the conversation that triggered it.
 * `ConversationRef` is structurally a `View`, so the UI store's `setView`
 * routes directly (home rail + DM, or server rail + channel).
 */
function useNotificationNavigation() {
  useEffect(() => {
    const onFocus = (): void => {
      const ref = takePendingConversation();
      if (ref !== null) useUi.getState().setView(ref);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
}

/**
 * Supprime le menu contextuel natif du système (« Recharger », hérité de la
 * vue web sous-jacente) partout sauf dans les champs de saisie, où le
 * copier/coller natif reste nécessaire. Les menus contextuels maison
 * (message, utilisateur, salon, serveur) font déjà leur propre
 * `preventDefault` avant d'ouvrir `ContextMenu` : `e.defaultPrevented` évite
 * alors tout travail redondant ici.
 */
function useSuppressNativeContextMenu(): void {
  useEffect(() => {
    const onContextMenu = (e: MouseEvent): void => {
      if (e.defaultPrevented || isEditableTarget(e.target)) return;
      e.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);
}

/** Câble les événements temps réel du nœud vers les stores. */
function useNodeEvents() {
  useEffect(() => {
    const off = rpc.onEvent((method, params) => {
      const event = { method, params } as AccordEvent;
      switch (event.method) {
        case 'event.dm': {
          const { peer, msg_id: msgId } = event.params;
          // Fusion incrémentale de la page récente (pas de rechargement
          // complet), puis notification éventuelle une fois l'auteur connu.
          void useDms
            .getState()
            .refresh(peer)
            .then(() => {
              const message = (useDms.getState().conversations[peer] ?? []).find(
                (m) => m.msg_id === msgId,
              );
              if (message !== undefined) {
                notifyNewMessage({ kind: 'dm', peer }, message.author);
                maybePlaySound(
                  { kind: 'dm', peer },
                  message.author,
                  message.mentions_me === true,
                );
              }
            })
            .catch(() => {
              // Best effort : le fil sera rechargé au prochain événement.
            });
          // Conversation non affichée : rafraîchit le compteur de non-lus du
          // contact (la vue ouverte marque lue elle-même, ce qui recharge déjà).
          const view = useUi.getState().view;
          if (!(view.kind === 'dm' && view.peer === peer)) {
            void useFriends.getState().load();
          }
          break;
        }
        case 'event.dm_typing':
          useTyping
            .getState()
            .noteTyping(dmTypingKey(event.params.peer), event.params.peer);
          break;
        case 'event.friend_request':
        case 'event.friend_response':
          void useFriends.getState().load();
          break;
        case 'event.profile':
          // Profil d'un ami annoncé : pseudo, bio et avatar mis à jour en
          // place, sans repasser par le nœud.
          useFriends.getState().applyProfile(event.params);
          break;
        case 'event.presence':
          // Présence best-effort d'un ami : reflétée sur le contact connu.
          useFriends.getState().applyPresence(event.params.pubkey, event.params.online);
          break;
        case 'event.group_op':
        case 'event.group_key':
          void useGroups.getState().loadList();
          break;
        case 'event.group_state':
          // Op appliquée (locale ou distante) : recharger l'état du groupe.
          void useGroups
            .getState()
            .handleGroupState(event.params.group_id)
            .catch(() => {
              // Best effort : l'état sera rechargé au prochain événement.
            });
          break;
        case 'event.group_msg': {
          const {
            group_id: groupId,
            channel_id: channelId,
            msg_id: msgId,
          } = event.params;
          void useGroups
            .getState()
            .refreshHistory(groupId, channelId)
            .then(() => {
              const key = channelKey(groupId, channelId);
              const message = (useGroups.getState().messages[key] ?? []).find(
                (m) => m.msg_id === msgId,
              );
              if (message !== undefined) {
                notifyNewMessage({ kind: 'group', groupId, channelId }, message.author);
                maybePlaySound(
                  { kind: 'group', groupId, channelId },
                  message.author,
                  message.mentions_me === true,
                );
              }
            })
            .catch(() => {
              // Best effort : l'historique sera rechargé au prochain événement.
            });
          // Salon non affiché : rafraîchit les compteurs de non-lus (le salon
          // ouvert marque lu lui-même, ce qui rafraîchit déjà).
          const view = useUi.getState().view;
          const displayed =
            view.kind === 'group' &&
            view.groupId === groupId &&
            view.channelId === channelId;
          if (!displayed) {
            void useGroups
              .getState()
              .refreshUnread()
              .catch(() => {
                // Best effort : compteurs corrigés au prochain passage.
              });
          }
          break;
        }
        case 'event.group_typing': {
          const { group_id: groupId, channel_id: channelId, pubkey } = event.params;
          useTyping.getState().noteTyping(groupTypingKey(groupId, channelId), pubkey);
          break;
        }
        case 'event.voice_joined':
          useVoice.getState().applyJoined(event.params);
          break;
        case 'event.voice_left':
          useVoice.getState().applyLeft(event.params);
          break;
        case 'event.voice_speaking':
          useVoice.getState().applySpeaking(event.params);
          break;
        case 'event.voice_mute':
          useVoice.getState().applyMuteState(event.params);
          break;
        case 'event.desynchronise': {
          void useFriends.getState().load();
          void useGroups.getState().loadList();
          break;
        }
      }
    });
    return off;
  }, []);
}

export function AppShell() {
  const t = useT();
  const view = useUi((s) => s.view);
  const toast = useUi((s) => s.toast);
  const loadFriends = useFriends((s) => s.load);
  const loadGroups = useGroups((s) => s.loadList);
  const syncVoice = useVoice((s) => s.sync);
  useNodeEvents();
  useNotificationNavigation();
  useSuppressNativeContextMenu();

  // Appui-pour-parler global : actif dès qu'un salon vocal est rejoint.
  const onPttError = useCallback(() => toast('error', t.errors.actionFailed), [toast, t]);
  usePushToTalk(onPttError);

  useEffect(() => {
    void loadFriends();
    void loadGroups();
    // Reprise vocale : resynchronise le salon actif éventuel (voice.status).
    syncVoice().catch(() => {
      // Best effort : sans réponse du nœud, l'état vocal local reste vide.
    });
  }, [loadFriends, loadGroups, syncVoice]);

  return (
    <div className="flex h-full">
      <ServerRail />
      <Sidebar />
      <main className="min-w-0 flex-1 bg-chat" aria-label={t.app.name}>
        {view.kind === 'friends' && <FriendsView />}
        {view.kind === 'dm' && <DmView peer={view.peer} />}
        {view.kind === 'group' && (
          <GroupView groupId={view.groupId} channelId={view.channelId} />
        )}
      </main>
      <Modals />
      <ProfilePopover />
      <ContextMenu />
    </div>
  );
}
