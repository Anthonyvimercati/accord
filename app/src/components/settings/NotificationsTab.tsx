/**
 * Onglet Notifications : autorisation système (plugin Tauri, repli explicite
 * hors application) et réglages persistés — messages privés, messages de
 * groupe, « seulement en arrière-plan ». Le câblage de l'envoi vit dans
 * AppShell ; ici on ne gère que l'intention de l'utilisateur.
 */

import { useEffect, useState } from 'react';
import {
  queryNotificationPermission,
  requestNotificationPermission,
  type NotificationPermission,
} from '../../lib/notifications';
import { useUi, useT } from '../../stores/ui';
import { SettingsSection, ToggleRow } from './controls';

export function NotificationsTab() {
  const t = useT();
  const notifyDms = useUi((s) => s.notifyDms);
  const notifyGroups = useUi((s) => s.notifyGroups);
  const notifyOnlyUnfocused = useUi((s) => s.notifyOnlyUnfocused);
  const setNotifyDms = useUi((s) => s.setNotifyDms);
  const setNotifyGroups = useUi((s) => s.setNotifyGroups);
  const setNotifyOnlyUnfocused = useUi((s) => s.setNotifyOnlyUnfocused);

  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  useEffect(() => {
    let cancelled = false;
    void queryNotificationPermission().then((state) => {
      if (!cancelled) setPermission(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const askPermission = (): void => {
    void requestNotificationPermission().then(setPermission);
  };

  const permissionLabel =
    permission === 'granted'
      ? t.settings.notifPermissionGranted
      : permission === 'unavailable'
        ? t.settings.notifPermissionUnavailable
        : t.settings.notifPermissionDenied;

  return (
    <div>
      <SettingsSection title={t.settings.notifPermissionTitle}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sidebar px-4 py-3">
          <span
            className={`text-sm ${permission === 'granted' ? 'text-green' : 'text-muted'}`}
          >
            {permissionLabel}
          </span>
          {permission === 'denied' && (
            <button
              type="button"
              onClick={askPermission}
              className="rounded bg-blurple px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blurple-hover"
            >
              {t.settings.notifAllow}
            </button>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t.settings.notifPrefsTitle}
        hint={t.settings.notifPrivacyHint}
      >
        <ToggleRow
          label={t.settings.notifDms}
          checked={notifyDms}
          onChange={setNotifyDms}
        />
        <ToggleRow
          label={t.settings.notifGroups}
          checked={notifyGroups}
          onChange={setNotifyGroups}
        />
        <ToggleRow
          label={t.settings.notifOnlyUnfocused}
          checked={notifyOnlyUnfocused}
          onChange={setNotifyOnlyUnfocused}
        />
      </SettingsSection>
    </div>
  );
}
