/**
 * Barre d'actions flottante d'un message (survol), à la Discord :
 * réaction rapide (petit choix d'emojis courants), réponse (MP uniquement),
 * épinglage (salons, avec MANAGE_MESSAGES), puis édition (auteur seul) et
 * suppression (auteur, ou modération). La suppression demande une
 * confirmation légère en place ; Échap referme les volets ouverts.
 */

import { useState } from 'react';
import { interpolate } from '../i18n';
import { valeurReaction } from '../lib/emoji';
import { useT } from '../stores/ui';
import { EmojiPicker } from './EmojiPicker';

/** Choix restreint d'emojis courants proposés au survol. */
export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'] as const;

interface MessageActionsProps {
  /** Édition permise (auteur du message uniquement). */
  canEdit: boolean;
  /** Suppression permise (auteur, ou MANAGE_MESSAGES en salon). */
  canDelete: boolean;
  onReact: (emoji: string) => void;
  /** Réponse citée — absente dans les salons (non prévue par l'API). */
  onReply?: (() => void) | undefined;
  onEdit: () => void;
  onDelete: () => void;
  /** Épinglage — absent hors salon ou sans MANAGE_MESSAGES. */
  onTogglePin?: (() => void) | undefined;
  /** Vrai si le message est épinglé (le libellé devient « Désépingler »). */
  pinned?: boolean;
  /** Contexte serveur : expose ses émojis custom au sélecteur (`null` en MP). */
  groupId?: string | null;
}

function ActionButton({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`p-1.5 transition-colors first:rounded-l-md last:rounded-r-md hover:bg-chat-hover focus-visible:bg-chat-hover focus-visible:outline-none ${
        danger
          ? 'text-muted hover:text-red focus-visible:text-red'
          : 'text-muted hover:text-norm focus-visible:text-norm'
      }`}
    >
      {children}
    </button>
  );
}

export function MessageActions({
  canEdit,
  canDelete,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onTogglePin,
  pinned = false,
  groupId = null,
}: MessageActionsProps) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const closePanels = (): void => {
    setPickerOpen(false);
    setMoreOpen(false);
    setConfirming(false);
  };

  // Forcée visible quand un volet est ouvert, sinon révélée au survol/focus.
  const revealed = pickerOpen || moreOpen || confirming;

  return (
    <div
      className={`absolute -top-4 right-4 z-10 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 ${
        revealed ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') closePanels();
      }}
    >
      {pickerOpen && (
        <div
          role="menu"
          aria-label={t.dm.addReaction}
          className="absolute bottom-full right-0 mb-1.5 flex gap-0.5 rounded-full border border-rail bg-sidebar p-1 shadow-elevation"
        >
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              aria-label={interpolate(t.dm.reactWith, { emoji })}
              title={interpolate(t.dm.reactWith, { emoji })}
              onClick={() => {
                setPickerOpen(false);
                onReact(emoji);
              }}
              className="rounded-full p-1 text-lg leading-none transition-transform hover:scale-125 hover:bg-chat-hover focus-visible:scale-125 focus-visible:outline-none"
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            aria-label={t.emoji.more}
            title={t.emoji.more}
            onClick={() => {
              setPickerOpen(false);
              setMoreOpen(true);
            }}
            className="rounded-full p-1 text-muted transition-colors hover:bg-chat-hover hover:text-norm focus-visible:outline-none"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z" />
            </svg>
          </button>
        </div>
      )}
      {moreOpen && (
        <EmojiPicker
          groupId={groupId}
          positionClass="bottom-full right-0 mb-1.5"
          onSelect={(pick) => {
            setMoreOpen(false);
            onReact(valeurReaction(pick));
          }}
          onClose={() => setMoreOpen(false)}
        />
      )}
      {confirming && (
        <div
          role="alertdialog"
          aria-label={t.dm.deleteConfirm}
          className="absolute bottom-full right-0 mb-1.5 flex items-center gap-2 whitespace-nowrap rounded-md border border-rail bg-sidebar px-3 py-2 shadow-elevation"
        >
          <span className="text-sm text-norm">{t.dm.deleteConfirm}</span>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
            className="rounded bg-red px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-red/80"
          >
            {t.dm.delete}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="px-1 py-1 text-xs font-medium text-norm hover:underline"
          >
            {t.app.cancel}
          </button>
        </div>
      )}
      <div className="flex items-center rounded-md border border-rail bg-sidebar shadow-elevation">
        <ActionButton
          label={t.dm.addReaction}
          onClick={() => {
            setConfirming(false);
            setPickerOpen((open) => !open);
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm-3.5-8.5A1.5 1.5 0 1 0 8.5 8.5a1.5 1.5 0 0 0 0 3Zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-3.5 6c2.3 0 4.3-1.4 5.1-3.5H6.9c.8 2.1 2.8 3.5 5.1 3.5Z" />
          </svg>
        </ActionButton>
        {onReply !== undefined && (
          <ActionButton
            label={t.dm.reply}
            onClick={() => {
              closePanels();
              onReply();
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M10 8.3V4.9c0-.8-1-1.3-1.6-.7L1.7 10.3a1 1 0 0 0 0 1.5l6.7 6.1c.6.6 1.6.1 1.6-.7v-3.4c4.9 0 8.5 1.2 11 4.6-.1-6.1-3.3-9.6-11-10.1Z" />
            </svg>
          </ActionButton>
        )}
        {onTogglePin !== undefined && (
          <ActionButton
            label={pinned ? t.serveur.unpin : t.serveur.pin}
            onClick={() => {
              closePanels();
              onTogglePin();
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M14.6 2.6a1 1 0 0 1 1.4 0l5.4 5.4a1 1 0 0 1 0 1.4l-1.2 1.2a1 1 0 0 1-1 .3l-.7-.2-3.7 3.7.4 2.7a1 1 0 0 1-.3.9l-.9.9a1 1 0 0 1-1.4 0l-3.2-3.2-4.7 4.7a1 1 0 0 1-1.5-1.5l4.8-4.7-3.3-3.2a1 1 0 0 1 0-1.4l1-.9a1 1 0 0 1 .8-.3l2.7.4 3.7-3.7-.2-.7a1 1 0 0 1 .3-1l1.6-.8Z" />
            </svg>
          </ActionButton>
        )}
        {canEdit && (
          <ActionButton
            label={t.dm.edit}
            onClick={() => {
              closePanels();
              onEdit();
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M16.9 3.1a2.3 2.3 0 0 1 3.2 0l.8.8a2.3 2.3 0 0 1 0 3.2L9.6 18.4l-4.9 1.2a.6.6 0 0 1-.7-.7l1.2-4.9L16.9 3.1Zm1.4 1.4L6.6 16.2l-.7 2.7 2.7-.7L20.3 6.5a.3.3 0 0 0 0-.4l-.8-.8a.3.3 0 0 0-.4 0l-.8.2Z" />
            </svg>
          </ActionButton>
        )}
        {canDelete && (
          <ActionButton
            label={t.dm.delete}
            danger
            onClick={() => {
              setPickerOpen(false);
              setConfirming((open) => !open);
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7H4a1 1 0 0 1 0-2h4V4a1 1 0 0 1 1-1Zm-2 4v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7H7Zm3 3a1 1 0 0 1 2 0v7a1 1 0 1 1-2 0v-7Zm4-1a1 1 0 0 0-1 1v7a1 1 0 1 0 2 0v-7a1 1 0 0 0-1-1Z" />
            </svg>
          </ActionButton>
        )}
      </div>
    </div>
  );
}
