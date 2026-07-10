/**
 * Pont vers l'hôte Tauri : cycle de vie de l'identité et démarrage du nœud
 * embarqué. En mode navigateur (développement UI sans Tauri), une session de
 * secours est lue dans `localStorage` (`accord.dev.session`, écrite à la main
 * à partir du `session.json` d'un démon `accord-noded`).
 */

import { invoke } from '@tauri-apps/api/core';

export type VaultStatus = 'absent' | 'locked';

export interface SessionInfo {
  port: number;
  token: string;
}

export interface CreatedIdentity {
  session: SessionInfo;
  /** Phrase de récupération de 12 mots — affichée une seule fois. */
  recovery_phrase: string;
}

export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

const DEV_SESSION_KEY = 'accord.dev.session';

function devSession(): SessionInfo | null {
  const raw = window.localStorage.getItem(DEV_SESSION_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as SessionInfo).port === 'number' &&
      typeof (parsed as SessionInfo).token === 'string'
    ) {
      return parsed as SessionInfo;
    }
  } catch {
    // Valeur illisible : ignorée.
  }
  return null;
}

export async function vaultStatus(): Promise<VaultStatus> {
  if (!isTauri()) return devSession() ? 'locked' : 'absent';
  return invoke<VaultStatus>('vault_status');
}

export async function createIdentity(passphrase: string): Promise<CreatedIdentity> {
  if (!isTauri()) {
    throw new Error('création indisponible hors Tauri (mode développement)');
  }
  return invoke<CreatedIdentity>('create_identity', { passphrase });
}

export async function restoreIdentity(
  phrase: string,
  passphrase: string,
): Promise<SessionInfo> {
  if (!isTauri()) {
    throw new Error('restauration indisponible hors Tauri (mode développement)');
  }
  return invoke<SessionInfo>('restore_identity', { phrase, passphrase });
}

export async function unlockIdentity(passphrase: string): Promise<SessionInfo> {
  if (!isTauri()) {
    const session = devSession();
    if (session) return session;
    throw new Error('aucune session de développement (accord.dev.session)');
  }
  return invoke<SessionInfo>('unlock', { passphrase });
}

/**
 * Locks the vault without quitting the app: stops the embedded node and wipes
 * its in-memory keys, then returns the fresh vault status so the UI can land
 * on the same screen as a cold start. Outside Tauri (browser development)
 * nothing runs locally, so the status is derived from the dev session alone.
 */
export async function lockIdentity(): Promise<VaultStatus> {
  if (!isTauri()) return devSession() ? 'locked' : 'absent';
  return invoke<VaultStatus>('lock');
}
