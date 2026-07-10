/** Onglet Langue : sélecteur FR/EN (application immédiate, persistée). */

import type { Lang } from '../../i18n';
import { useUi, useT } from '../../stores/ui';
import { OptionPill, SettingsSection } from './controls';

export function LanguageTab() {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const setLang = useUi((s) => s.setLang);

  const langs: { id: Lang; label: string }[] = [
    { id: 'fr', label: t.settings.french },
    { id: 'en', label: t.settings.english },
  ];

  return (
    <SettingsSection title={t.settings.language} hint={t.settings.languageHint}>
      <div className="flex gap-2">
        {langs.map(({ id, label }) => (
          <OptionPill key={id} selected={lang === id} onSelect={() => setLang(id)}>
            {label}
          </OptionPill>
        ))}
      </div>
    </SettingsSection>
  );
}
