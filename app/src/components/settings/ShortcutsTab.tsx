/**
 * Onglet Raccourcis clavier : aide-mémoire des raccourcis globaux (sélecteur
 * rapide, navigation, vocal) et de composition (Entrée/Maj+Entrée, déjà
 * actifs dans `MessageInput`) — purement informatif, aucun réglage ici.
 * `⌘` s'affiche sur macOS (`navigator.platform`), `Ctrl` ailleurs.
 */

import { isMacPlatform } from '../../lib/quickSwitch';
import { useT } from '../../stores/ui';
import { SettingsSection } from './controls';

/**
 * Une combinaison de touches, rendue en pastilles façon clavier. Sépare sur
 * `|` quand ce caractère est présent (pour une combo contenant un `+` littéral,
 * ex. le zoom `Ctrl|+`), sinon sur `+` (forme historique `Ctrl+K`).
 */
function Kbd({ combo }: { combo: string }) {
  const keys = combo.includes('|') ? combo.split('|') : combo.split('+');
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((key, i) => (
        <kbd
          key={i}
          className="rounded-sm border border-rail bg-input px-1.5 py-0.5 font-mono text-[11px] font-medium text-norm"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

function ShortcutRow({ label, combo }: { label: string; combo: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-4 rounded-lg bg-sidebar px-4 py-2.5">
      <span className="min-w-0 text-sm text-norm">{label}</span>
      <Kbd combo={combo} />
    </div>
  );
}

export function ShortcutsTab() {
  const t = useT();
  const mod = isMacPlatform() ? '⌘' : 'Ctrl';

  return (
    <div>
      <SettingsSection title={t.shortcuts.navigationSection}>
        <ShortcutRow label={t.shortcuts.quickSwitchLabel} combo={`${mod}+K`} />
        <ShortcutRow label={t.shortcuts.prevChannelLabel} combo="Alt+↑" />
        <ShortcutRow label={t.shortcuts.nextChannelLabel} combo="Alt+↓" />
        <ShortcutRow label={t.shortcuts.closeLabel} combo={t.settings.escKey} />
      </SettingsSection>
      <SettingsSection title={t.shortcuts.interfaceSection}>
        <ShortcutRow label={t.shortcuts.zoomInLabel} combo={`${mod}|+`} />
        <ShortcutRow label={t.shortcuts.zoomOutLabel} combo={`${mod}|-`} />
        <ShortcutRow label={t.shortcuts.zoomResetLabel} combo={`${mod}|0`} />
      </SettingsSection>
      <SettingsSection title={t.shortcuts.messagingSection}>
        <ShortcutRow label={t.shortcuts.toggleMuteLabel} combo={`${mod}+⇧+M`} />
        <ShortcutRow label={t.shortcuts.sendMessageLabel} combo={t.shortcuts.keyEnter} />
        <ShortcutRow
          label={t.shortcuts.newLineLabel}
          combo={`⇧+${t.shortcuts.keyEnter}`}
        />
      </SettingsSection>
    </div>
  );
}
