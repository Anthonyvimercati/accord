/**
 * Onglet Profil du serveur : renommage (1 à 100 caractères) et icône —
 * image locale choisie via <input type="file">, recadrée dans un recadreur
 * interactif (carré) puis envoyée en base64 à `groups.set_icon`.
 */

import { useEffect, useRef, useState } from 'react';
import { lireFichier } from '../../lib/files';
import { initials } from '../../lib/format';
import { useGroups, hasPerm, PERMISSIONS } from '../../stores/groups';
import { useUi, useT } from '../../stores/ui';
import { AvatarCropper } from '../AvatarCropper';
import { SettingsSection } from '../settings/controls';
import { messageOf } from './controls';

/** Bornes du nom de serveur (contrat groups.rename). */
const NAME_MIN = 1;
const NAME_MAX = 100;

export function ServerProfileTab({ groupId }: { groupId: string }) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const state = useGroups((s) => s.states[groupId]);
  const rename = useGroups((s) => s.rename);
  const setIcon = useGroups((s) => s.setIcon);
  const [draft, setDraft] = useState(state?.name ?? '');
  const [busy, setBusy] = useState(false);
  /** Aperçu courant : icône publiée, remplacée par l'image fraîche choisie. */
  const [preview, setPreview] = useState<string | null>(null);
  /** Image en cours de recadrage (recadreur ouvert tant que non nulle). */
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const icon = state?.icon ?? null;
  useEffect(() => {
    let alive = true;
    setPreview(null);
    if (icon === null) return undefined;
    lireFichier(icon)
      .then((url) => {
        if (alive) setPreview(url);
      })
      .catch(() => {
        // Icône indisponible : l'aperçu retombe sur les initiales.
      });
    return () => {
      alive = false;
    };
  }, [icon]);

  if (!state) return null;

  const canManage = hasPerm(state.my_permissions, PERMISSIONS.MANAGE_CHANNELS);
  const trimmed = draft.trim();
  const valid = trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX;
  const dirty = trimmed !== state.name;

  const save = async (): Promise<void> => {
    if (!canManage || !valid || !dirty || busy) return;
    setBusy(true);
    try {
      await rename(groupId, trimmed);
      toast('info', t.serveur.renamed);
    } catch (e) {
      toast('error', messageOf(e, t.errors.actionFailed));
    } finally {
      setBusy(false);
    }
  };

  const onCrop = async (
    dataB64: string,
    mime: string,
    dataUrl: string,
  ): Promise<void> => {
    setBusy(true);
    try {
      await setIcon(groupId, dataB64, mime);
      setPreview(dataUrl);
      toast('info', t.serveur.iconUpdated);
    } catch (e) {
      toast('error', messageOf(e, t.errors.actionFailed));
    } finally {
      setBusy(false);
      setCropFile(null);
    }
  };

  return (
    <div>
      <SettingsSection title={t.serveur.profileName} hint={t.serveur.profileNameHint}>
        <div className="flex gap-3 rounded-lg bg-sidebar p-3">
          <input
            aria-label={t.serveur.profileName}
            value={draft}
            disabled={!canManage}
            maxLength={NAME_MAX + 8}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-input px-3 py-2 text-sm text-norm placeholder-faint outline-none transition-colors duration-fast focus:border-blurple/50 disabled:opacity-60"
          />
          {canManage && (
            <button
              type="button"
              disabled={!valid || !dirty || busy}
              onClick={() => void save()}
              className="rounded-lg bg-blurple px-4 py-2 text-sm font-medium text-white transition-colors duration-fast hover:bg-blurple-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar disabled:opacity-50"
            >
              {t.serveur.rename}
            </button>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title={t.serveur.icon} hint={t.serveur.iconHint}>
        <div className="flex items-center gap-4 rounded-lg bg-sidebar p-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-server bg-rail text-2xl font-semibold text-norm">
            {preview !== null ? (
              <img
                src={preview}
                alt={t.serveur.icon}
                width={80}
                height={80}
                className="h-full w-full object-cover"
              />
            ) : (
              initials(state.name)
            )}
          </div>
          {canManage && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                aria-label={t.serveur.chooseImage}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Autorise de re-choisir le même fichier plus tard.
                  e.target.value = '';
                  if (file !== undefined) setCropFile(file);
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="rounded-lg bg-blurple px-4 py-2 text-sm font-medium text-white transition-colors duration-fast hover:bg-blurple-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar disabled:opacity-50"
              >
                {t.serveur.chooseImage}
              </button>
            </>
          )}
        </div>
      </SettingsSection>
      {cropFile !== null && (
        <AvatarCropper
          fichier={cropFile}
          forme="carre"
          onAnnuler={() => setCropFile(null)}
          onValider={(r) => onCrop(r.dataB64, r.mime, r.dataUrl)}
        />
      )}
    </div>
  );
}
