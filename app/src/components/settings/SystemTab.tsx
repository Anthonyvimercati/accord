/**
 * Onglet Système : lancement au démarrage, icône dans la barre des
 * menus/systray et fermeture réduite. Le premier reflète toujours l'état réel
 * du système (`@tauri-apps/plugin-autostart`), jamais une intention locale
 * seule — les deux autres sont persistés côté UI (`stores/ui.ts`) et
 * appliqués en direct côté hôte (création/destruction de l'icône,
 * interception de fermeture) sans redémarrage requis.
 */

import { useEffect, useState } from 'react';
import { autostartIsEnabled, autostartSetEnabled } from '../../lib/bridge';
import { useUi, useT } from '../../stores/ui';
import { SettingsSection, ToggleRow } from './controls';

export function SystemTab() {
  const t = useT();
  const keepInTray = useUi((s) => s.keepInTray);
  const setKeepInTray = useUi((s) => s.setKeepInTray);
  const closeToTray = useUi((s) => s.closeToTray);
  const setCloseToTray = useUi((s) => s.setCloseToTray);

  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

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
    </div>
  );
}
