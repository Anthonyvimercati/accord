/**
 * Onglet Apparence : thème (sombre/clair), densité des messages et taille de
 * police. Chaque réglage s'applique immédiatement à la racine du document et
 * est persisté dans localStorage par le store d'interface.
 */

import { FONT_SCALES, useUi, useT, type Theme } from '../../stores/ui';
import { OptionPill, SettingsSection } from './controls';

/** Vignette de thème : aperçu miniature fidèle + libellé, façon Discord. */
function ThemeSwatch({
  theme,
  label,
  selected,
  onSelect,
}: {
  theme: Theme;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  // Couleurs figées de l'aperçu : chaque vignette montre SON thème,
  // indépendamment du thème actif — d'où l'absence de tokens sémantiques.
  const swatch =
    theme === 'dark'
      ? { canvas: 'bg-[#313338]', panel: 'bg-[#2b2d31]', line: 'bg-[#4e5058]' }
      : { canvas: 'bg-[#ffffff]', panel: 'bg-[#f2f3f5]', line: 'bg-[#d0d3d8]' };

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`group rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-chat ${
        selected ? '' : 'opacity-90 hover:opacity-100'
      }`}
    >
      <span
        aria-hidden
        className={`flex h-16 w-24 overflow-hidden rounded-lg border-2 transition-colors duration-150 ${
          swatch.canvas
        } ${selected ? 'border-blurple' : 'border-input group-hover:border-faint'}`}
      >
        <span className={`h-full w-1/4 ${swatch.panel}`} />
        <span className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
          <span className={`h-1.5 w-3/4 rounded-full ${swatch.line}`} />
          <span className={`h-1.5 w-1/2 rounded-full ${swatch.line}`} />
          <span className="mt-auto h-1.5 w-2/3 rounded-full bg-blurple" />
        </span>
      </span>
      <span
        className={`mt-1.5 block text-sm font-medium ${
          selected ? 'text-header' : 'text-muted group-hover:text-norm'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

export function AppearanceTab() {
  const t = useT();
  const theme = useUi((s) => s.theme);
  const density = useUi((s) => s.density);
  const fontScale = useUi((s) => s.fontScale);
  const setTheme = useUi((s) => s.setTheme);
  const setDensity = useUi((s) => s.setDensity);
  const setFontScale = useUi((s) => s.setFontScale);

  return (
    <div>
      <SettingsSection title={t.settings.theme}>
        <div className="flex gap-4">
          <ThemeSwatch
            theme="dark"
            label={t.settings.themeDark}
            selected={theme === 'dark'}
            onSelect={() => setTheme('dark')}
          />
          <ThemeSwatch
            theme="light"
            label={t.settings.themeLight}
            selected={theme === 'light'}
            onSelect={() => setTheme('light')}
          />
        </div>
      </SettingsSection>

      <SettingsSection title={t.settings.density} hint={t.settings.densityHint}>
        <div className="flex gap-2">
          <OptionPill
            selected={density === 'comfortable'}
            onSelect={() => setDensity('comfortable')}
          >
            {t.settings.densityComfortable}
          </OptionPill>
          <OptionPill
            selected={density === 'compact'}
            onSelect={() => setDensity('compact')}
          >
            {t.settings.densityCompact}
          </OptionPill>
        </div>
      </SettingsSection>

      <SettingsSection title={t.settings.fontSize}>
        <div className="flex gap-2">
          {FONT_SCALES.map((scale) => (
            <OptionPill
              key={scale}
              selected={fontScale === scale}
              onSelect={() => setFontScale(scale)}
            >
              {scale} %
            </OptionPill>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}
