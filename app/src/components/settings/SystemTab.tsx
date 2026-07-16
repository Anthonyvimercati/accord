/**
 * Onglet Système : lancement au démarrage, icône dans la barre des
 * menus/systray et fermeture réduite. Le premier reflète toujours l'état réel
 * du système (`@tauri-apps/plugin-autostart`), jamais une intention locale
 * seule — les deux autres sont persistés côté UI (`stores/ui.ts`) et
 * appliqués en direct côté hôte (création/destruction de l'icône,
 * interception de fermeture) sans redémarrage requis.
 */

import { useEffect, useState } from 'react';
import {
  autostartIsEnabled,
  autostartSetEnabled,
  openSystemSettings,
  type SystemSettingsSection,
} from '../../lib/bridge';
import { api } from '../../lib/client';
import { requestNotificationPermission } from '../../lib/notifications';
import { useUi, useT } from '../../stores/ui';
import { SettingsSection, ToggleRow } from './controls';

/** Durée de la capture-éclair qui matérialise l'invite micro système. */
const MIC_PROMPT_PULSE_MS = 1500;

/**
 * Ligne d'autorisation : intitulé + explication, action de demande facultative
 * (l'OS n'affiche son invite qu'à l'état « indéterminé ») et raccourci vers le
 * panneau des réglages système — seul recours après un refus.
 */
function PermissionRow({
  title,
  hint,
  action,
  section,
}: {
  title: string;
  hint: string;
  action?: { label: string; busy: boolean; onClick: () => void };
  section: SystemSettingsSection;
}) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const openSettings = (): void => {
    openSystemSettings(section).catch(() => {
      toast('info', t.settings.systemPermsSettingsUnavailable);
    });
  };
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-sidebar px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-header">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-faint">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action !== undefined && (
          <button
            type="button"
            disabled={action.busy}
            onClick={action.onClick}
            className="rounded-md bg-blurple px-3 py-1.5 text-sm font-medium text-white transition-colors duration-fast hover:bg-blurple-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-modal disabled:opacity-60"
          >
            {action.label}
          </button>
        )}
        <button
          type="button"
          onClick={openSettings}
          className="rounded-md bg-rail px-3 py-1.5 text-sm font-medium text-norm transition-colors duration-fast hover:bg-input hover:text-header focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-modal"
        >
          {t.settings.systemPermsOpenSettings}
        </button>
      </div>
    </div>
  );
}

export function SystemTab() {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const keepInTray = useUi((s) => s.keepInTray);
  const setKeepInTray = useUi((s) => s.setKeepInTray);
  const closeToTray = useUi((s) => s.closeToTray);
  const setCloseToTray = useUi((s) => s.setCloseToTray);

  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [micBusy, setMicBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void autostartIsEnabled().then((enabled) => {
      if (!cancelled) setAutostart(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleAutostart = (next: boolean): void => {
    setAutostartBusy(true);
    void autostartSetEnabled(next)
      .then(() => autostartIsEnabled())
      .then(setAutostart)
      .finally(() => setAutostartBusy(false));
  };

  // Demandes SÉPARÉES par autorisation : deux invites système empilées d'un
  // coup (l'ancien bouton combiné) se lisaient comme une boucle de dialogues.
  // L'OS ne ré-affiche l'invite que si l'état est « indéterminé » ; après un
  // refus explicite, seul le panneau système (bouton dédié) permet de revenir.
  const requestNotifications = (): void => {
    setNotifBusy(true);
    void requestNotificationPermission()
      .then((notif) => {
        toast(
          'info',
          notif === 'granted'
            ? t.settings.systemPermsNotifGranted
            : t.settings.systemPermsNotifDenied,
        );
      })
      .finally(() => setNotifBusy(false));
  };

  // Capture-éclair d'une seconde : l'unique moyen côté app de matérialiser
  // l'invite micro de l'OS (elle n'apparaît qu'à la première VRAIE capture).
  // Une seule à la fois — le verrou évite d'empiler des invites.
  const requestMicrophone = (): void => {
    setMicBusy(true);
    void api
      .voiceMicTest(true)
      .catch(() => undefined)
      .then(() => {
        window.setTimeout(() => {
          void api.voiceMicTest(false).catch(() => undefined);
          setMicBusy(false);
        }, MIC_PROMPT_PULSE_MS);
        toast('info', t.settings.systemPermsMicRequested);
      });
  };

  return (
    <div>
      <SettingsSection
        title={t.settings.systemStartupTitle}
        hint={t.settings.systemStartupHint}
      >
        <ToggleRow
          label={t.settings.systemAutostart}
          hint={t.settings.systemAutostartHint}
          checked={autostart}
          disabled={autostartBusy}
          onChange={toggleAutostart}
        />
      </SettingsSection>

      <SettingsSection title={t.settings.systemTrayTitle}>
        <ToggleRow
          label={t.settings.systemKeepInTray}
          hint={t.settings.systemKeepInTrayHint}
          checked={keepInTray}
          onChange={setKeepInTray}
        />
        <ToggleRow
          label={t.settings.systemCloseToTray}
          hint={
            keepInTray
              ? t.settings.systemCloseToTrayHint
              : t.settings.systemCloseToTrayDisabledHint
          }
          checked={closeToTray}
          disabled={!keepInTray}
          onChange={setCloseToTray}
        />
      </SettingsSection>

      <SettingsSection
        title={t.settings.systemPermsTitle}
        hint={t.settings.systemPermsHint}
      >
        <div className="space-y-2">
          <PermissionRow
            title={t.settings.systemPermsNotifTitle}
            hint={t.settings.systemPermsNotifHint}
            action={{
              label: t.settings.systemPermsNotifButton,
              busy: notifBusy,
              onClick: requestNotifications,
            }}
            section="notifications"
          />
          <PermissionRow
            title={t.settings.systemPermsMicTitle}
            hint={t.settings.systemPermsMicHint}
            action={{
              label: t.settings.systemPermsMicButton,
              busy: micBusy,
              onClick: requestMicrophone,
            }}
            section="microphone"
          />
          <PermissionRow
            title={t.settings.systemPermsNetTitle}
            hint={t.settings.systemPermsNetHint}
            section="firewall"
          />
        </div>
      </SettingsSection>
    </div>
  );
}
