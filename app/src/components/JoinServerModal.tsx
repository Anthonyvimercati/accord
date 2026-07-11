/**
 * Rejoindre un serveur via un lien d'invitation partageable : un champ pour
 * coller un code `accord://invite/…`, validé côté UI (préfixe) avant l'appel
 * `groups.invite_link_redeem`. Au succès, rafraîchit la liste des groupes
 * (`loadList`, comme `create`), notifie et ferme ; à l'échec, garde le modal
 * ouvert avec un toast d'erreur.
 */

import { useState } from 'react';
import { interpolate } from '../i18n';
import { api } from '../lib/client';
import { isInviteLink } from '../lib/invite';
import { useGroups } from '../stores/groups';
import { useT, useUi } from '../stores/ui';
import { ModalFrame } from './Modals';

export function JoinServerModal() {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const closeModal = useUi((s) => s.closeModal);
  const loadList = useGroups((s) => s.loadList);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const trimmed = code.trim();
    if (trimmed === '' || busy) return;
    if (!isInviteLink(trimmed)) {
      toast('error', t.joinServer.invalid);
      return;
    }
    setBusy(true);
    try {
      const res = await api.groupsInviteLinkRedeem(trimmed);
      if (!res.ok) {
        toast('error', t.joinServer.failed);
        setBusy(false);
        return;
      }
      await loadList();
      toast('info', interpolate(t.joinServer.joined, { name: res.group_name }));
      closeModal();
    } catch {
      toast('error', t.joinServer.failed);
      setBusy(false);
    }
  };

  return (
    <ModalFrame title={t.joinServer.title} hint={t.joinServer.hint}>
      <input
        aria-label={t.joinServer.placeholder}
        placeholder={t.joinServer.placeholder}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        className="w-full rounded-md border border-transparent bg-input px-3 py-2.5 text-norm placeholder-faint outline-none transition-colors duration-fast focus:border-blurple/50"
      />
      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={closeModal}
          className="rounded-sm px-4 py-2 text-sm font-medium text-muted transition-colors duration-fast hover:bg-chat-hover hover:text-norm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-modal"
        >
          {t.app.cancel}
        </button>
        <button
          type="button"
          disabled={code.trim() === '' || busy}
          onClick={() => void submit()}
          className="rounded-lg bg-blurple px-4 py-2 text-sm font-medium text-white transition-colors duration-fast hover:bg-blurple-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-modal disabled:opacity-50 active:scale-[0.98]"
        >
          {t.joinServer.action}
        </button>
      </div>
    </ModalFrame>
  );
}
