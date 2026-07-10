/**
 * Onglet Confidentialité : liste des utilisateurs bloqués (avec déblocage) et
 * rappel du fonctionnement anti-spam des demandes d'amis.
 */

import { useEffect } from 'react';
import { useFriends } from '../../stores/friends';
import { useUi, useT } from '../../stores/ui';
import { Avatar } from '../Avatar';
import { SettingsSection } from './controls';

export function PrivacyTab() {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const contacts = useFriends((s) => s.contacts);
  const load = useFriends((s) => s.load);
  const unblock = useFriends((s) => s.unblock);

  useEffect(() => {
    load().catch(() => toast('error', t.errors.loadFailed));
  }, [load, toast, t]);

  const blocked = contacts.filter((c) => c.state === 'blocked');

  return (
    <div>
      <SettingsSection title={t.settings.blockedUsers}>
        {blocked.length === 0 ? (
          <p className="rounded-lg bg-sidebar px-4 py-6 text-center text-sm text-muted">
            {t.friends.emptyBlocked}
          </p>
        ) : (
          <ul className="divide-y divide-input rounded-lg bg-sidebar px-2">
            {blocked.map((contact) => {
              const name = contact.display_name.trim() || contact.friend_code;
              return (
                <li key={contact.pubkey} className="flex items-center gap-3 px-2 py-2.5">
                  <Avatar id={contact.pubkey} name={name} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-header">{name}</div>
                    <div className="truncate text-xs text-faint">
                      {contact.friend_code}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      unblock(contact.pubkey).catch(() =>
                        toast('error', t.errors.actionFailed),
                      );
                    }}
                    className="rounded bg-rail px-3 py-1.5 text-sm font-medium text-norm transition-colors duration-150 hover:bg-red hover:text-white"
                  >
                    {t.friends.unblock}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection title={t.settings.antiSpamTitle}>
        <p className="rounded-lg border-l-4 border-blurple bg-sidebar px-4 py-3 text-sm leading-relaxed text-muted">
          {t.settings.antiSpamHint}
        </p>
      </SettingsSection>
    </div>
  );
}
