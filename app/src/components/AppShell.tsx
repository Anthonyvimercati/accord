/** Coquille principale trois colonnes : rail, barre latérale, contenu. */

import { useCallback, useEffect } from 'react';
import { dictionaries, interpolate } from '../i18n';
import type { AccordEvent } from '../lib/api';
import { rpc } from '../lib/client';
import { isNotificationEligible, sendNativeNotification } from '../lib/notifications';
import { usePushToTalk } from '../hooks/usePushToTalk';
import { useDms } from '../stores/dms';
import { useFriends, displayNameOf } from '../stores/friends';
import { useGroups, channelKey } from '../stores/groups';
import { useSession } from '../stores/session';
import { useTyping, dmTypingKey, groupTypingKey } from '../stores/typing';
import { useUi, useT } from '../stores/ui';
import { useVoice } from '../stores/voice';
import { DmView, GroupView } from './ChatView';
import { FriendsView } from './FriendsView';
import { Modals } from './Modals';
import { ProfilePopover } from './ProfilePopover';
import { ServerRail } from './ServerRail';
import { Sidebar } from './Sidebar';

/**
 * Notification native « Nouveau message de <nom> » si les réglages
 * l'autorisent — jamais le contenu du message, jamais ses propres messages.
 */
function notifyNewMessage(kind: 'dm' | 'group', author: string): void {
  const self = useSession.getState().self;
  if (self === null) return;
  const ui = useUi.getState();
  const eligible = isNotificationEligible({
    kind,
    prefs: {
      dms: ui.notifyDms,
      groups: ui.notifyGroups,
      onlyWhenUnfocused: ui.notifyOnlyUnfocused,
    },
    windowFocused: document.hasFocus(),
    isOwnMessage: author === self.pubkey,
  });
  if (!eligible) return;
  const dict = dictionaries[ui.lang];
  const name = displayNameOf(useFriends.getState().contacts, author);
  void sendNativeNotification(
    dict.app.name,
    interpolate(dict.notifications.newMessageFrom, { name }),
  );
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
              if (message !== undefined) notifyNewMessage('dm', message.author);
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
              if (message !== undefined) notifyNewMessage('group', message.author);
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
    </div>
  );
}
