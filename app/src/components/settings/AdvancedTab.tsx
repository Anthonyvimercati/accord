/**
 * Onglet Avancé : version de l'application, licence (MIT + dépendances
 * tierces) et identité technique (code ami copiable, identifiant de nœud).
 */

import { useState } from 'react';
import { interpolate } from '../../i18n';
import { APP_LICENSE, APP_VERSION, THIRD_PARTY_FILE } from '../../lib/meta';
import { useSession } from '../../stores/session';
import { useT } from '../../stores/ui';
import { SettingsSection } from './controls';

const COPY_FEEDBACK_MS = 1500;

export function AdvancedTab() {
  const t = useT();
  const self = useSession((s) => s.self);
  const [copied, setCopied] = useState(false);

  const copyCode = (): void => {
    if (!self) return;
    void navigator.clipboard.writeText(self.friend_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    });
  };

  return (
    <div>
      <SettingsSection title={t.settings.version}>
        <p className="text-sm text-norm">
          {t.app.name}{' '}
          <span className="selectable font-mono text-muted">{APP_VERSION}</span>
        </p>
      </SettingsSection>

      <SettingsSection title={t.settings.license}>
        <p className="text-sm leading-relaxed text-muted">
          {interpolate(t.settings.licenseText, { file: THIRD_PARTY_FILE })}{' '}
          <span className="font-mono text-xs text-faint">({APP_LICENSE})</span>
        </p>
      </SettingsSection>

      {self && (
        <SettingsSection title={t.settings.identity}>
          <div className="rounded-lg bg-sidebar p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase text-faint">
                  {t.friends.myCode}
                </div>
                <div className="selectable truncate font-mono text-norm">
                  {self.friend_code}
                </div>
              </div>
              <button
                type="button"
                onClick={copyCode}
                className="rounded bg-blurple px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blurple-hover"
              >
                {copied ? t.app.copied : t.settings.copyFriendCode}
              </button>
            </div>
            <div className="mt-3 text-xs font-semibold uppercase text-faint">
              {t.settings.nodeId}
            </div>
            <div className="selectable break-all font-mono text-xs text-muted">
              {self.node_id}
            </div>
          </div>
        </SettingsSection>
      )}
    </div>
  );
}
