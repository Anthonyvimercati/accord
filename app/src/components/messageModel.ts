/**
 * Modèle d'affichage d'un message du fil (`MessageList`) : `DisplayMessage`
 * normalise MP et salons (enveloppe + mutations déjà appliquées) et
 * `MessageListActions` regroupe les actions câblées par la vue. Module
 * feuille partagé par les sous-composants du fil (citation, corps, menus
 * contextuels) pour éviter tout import circulaire avec `MessageList`.
 */

import type { DeliveryState, FileAttachment, MsgBody, Reaction } from '../lib/api';
import type { View } from '../stores/ui';

export interface DisplayMessage {
  msg_id: string;
  author: string;
  sent_ms: number;
  deleted: boolean;
  body: MsgBody;
  edited: string | null;
  acked?: boolean;
  /** État de livraison sortante (MP uniquement) ; absent = considéré envoyé. */
  delivery?: DeliveryState;
  reactions?: Reaction[];
  /** Pièces jointes de l'enveloppe (`[]` ou absent si aucune). */
  attachments?: FileAttachment[];
}

/** Actions de message ; leur absence masque toute la barre. */
export interface MessageListActions {
  onReact: (message: DisplayMessage, emoji: string) => void;
  /** Réponse citée — absente dans les salons (non prévue par l'API). */
  onReply?: (message: DisplayMessage) => void;
  onEdit: (message: DisplayMessage, text: string) => void;
  onDelete: (message: DisplayMessage) => void;
  /** Modération : autorise la suppression des messages d'autrui. */
  canModerate?: boolean;
  /** Épinglage — `pinned` reflète l'état courant du message. */
  onTogglePin?: (message: DisplayMessage, pinned: boolean) => void;
  /** Relance d'un envoi échoué (MP uniquement) ; absente = pas d'affordance. */
  onRetry?: (message: DisplayMessage) => void;
}

/** Texte affichable d'un message (dernière édition, sinon corps d'origine). */
export function displayText(message: DisplayMessage): string | null {
  return message.edited ?? (message.body.type === 'text' ? message.body.text : null);
}

/**
 * Lien `accord:` copiable vers un message : `accord:msg/<conversation>/<id>`
 * où la conversation est `dm:<pair>` ou `group:<groupe>:<salon>`. Aucun
 * gestionnaire d'ouverture n'existe encore (copier suffit — voir le suivi).
 */
export function messageLink(view: View, msgId: string): string | null {
  if (view.kind === 'dm') return `accord:msg/dm:${view.peer}/${msgId}`;
  if (view.kind === 'group') {
    return `accord:msg/group:${view.groupId}:${view.channelId ?? ''}/${msgId}`;
  }
  return null;
}
