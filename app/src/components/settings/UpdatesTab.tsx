/**
 * Onglet Mises à jour (D-049, D-053) : version installée, vérification
 * manuelle et cycle installer → redémarrer. La vérification automatique
 * (démarrage + périodique) vit dans `App` ; ici on partage le même store,
 * donc l'état affiché est toujours celui du cycle réel.
 */

import { interpolate } from '../../i18n';
import { isTauri } from '../../lib/bridge';
import { APP_VERSION } from '../../lib/meta';
import { RELEASES_URL } from '../../lib/updater';
import { useUpdater } from '../../stores/updater';
import { useT } from '../../stores/ui';
import { SettingsSection } from './controls';

export function UpdatesTab() {
  const t = useT();
  const status = useUpdater((s) => s.status);
  const version = useUpdater((s) => s.version);
  const notes = useUpdater((s) => s.notes);
  const progress = useUpdater((s) => s.progress);
  const error = useUpdater((s) => s.error);
  const check = useUpdater((s) => s.check);
  const install = useUpdater((s) => s.install);
  const restart = useUpdater((s) => s.restart);

  if (!isTauri()) {
    return (
      <SettingsSection title={t.updates.title}>
        <div className="rounded-lg bg-sidebar p-4">
          <p className="text-sm text-muted">{t.updates.unavailable}</p>
        </div>
      </SettingsSection>
    );
  }

  const percent = progress !== null ? Math.round(progress * 100) : null;
  const statusText =
    status === 'checking'
      ? t.updates.checking
      : status === 'upToDate'
        ? t.updates.upToDate
        : status === 'available'
          ? interpolate(t.updates.available, { version: version ?? '' })
          : status === 'downloading'
            ? percent !== null
              ? interpolate(t.updates.downloading, { percent: String(percent) })
              : t.updates.downloadingIndeterminate
            : status === 'ready'
              ? t.updates.ready
              : status === 'error'
                ? interpolate(t.updates.error, { error: error ?? '' })
                : null;

  const action =
    status === 'idle' || status === 'upToDate'
      ? { label: t.updates.check, busy: false, run: () => void check(true) }
      : status === 'checking'
        ? { label: t.updates.checking, busy: true, run: () => undefined }
        : status === 'available'
          ? { label: t.updates.install, busy: false, run: () => void install() }
          : status === 'downloading'
            ? { label: t.updates.install, busy: true, run: () => undefined }
            : status === 'ready'
              ? { label: t.updates.restart, busy: false, run: () => void restart() }
              : {
                  label: t.updates.retry,
                  busy: false,
                  run: () => void (version !== null ? install() : check(true)),
                };

  return (
    <SettingsSection title={t.updates.title} hint={t.updates.hint}>
      <div className="rounded-lg bg-sidebar p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-norm">
              {interpolate(t.updates.current, { version: APP_VERSION })}
            </p>
            {statusText !== null && (
              <p role="status" className="mt-0.5 text-xs text-faint">
                {statusText}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={action.busy}
            onClick={action.run}
            className="rounded-md bg-blurple px-3 py-1.5 text-sm font-medium text-white transition-colors duration-fast hover:bg-blurple-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-modal disabled:opacity-60"
          >
            {action.label}
          </button>
        </div>
        {status === 'downloading' && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-input">
            <div
              className={`h-full rounded-full bg-blurple ${percent === null ? 'w-full animate-pulse' : ''}`}
              style={percent !== null ? { width: `${percent}%` } : undefined}
            />
          </div>
        )}
        {status === 'available' && notes !== null && (
          <div className="mt-3">
            <div className="text-xs font-medium uppercase text-faint">
              {t.updates.notes}
            </div>
            <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted">
              {notes}
            </p>
          </div>
        )}
        {status === 'error' && (
          <p className="selectable mt-2 break-all text-xs leading-relaxed text-faint">
            {interpolate(t.updates.errorFallback, { url: RELEASES_URL })}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
