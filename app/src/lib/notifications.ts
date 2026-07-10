/**
 * Notifications natives via le plugin Tauri (import dynamique, repli
 * silencieux hors Tauri) et règle d'éligibilité pure — testable en isolation.
 * Confidentialité : le contenu des messages n'est jamais transmis, seuls des
 * identifiants transitent dans les événements du nœud.
 */

import { isTauri } from './bridge';

export type NotifyKind = 'dm' | 'group';

/** Réglages de notification (store d'interface, persistés). */
export interface NotifyPrefs {
  dms: boolean;
  groups: boolean;
  onlyWhenUnfocused: boolean;
}

/**
 * Décide si un message entrant mérite une notification native, selon les
 * réglages, le focus de la fenêtre et l'auteur (jamais ses propres messages).
 */
export function isNotificationEligible(options: {
  kind: NotifyKind;
  prefs: NotifyPrefs;
  windowFocused: boolean;
  isOwnMessage: boolean;
}): boolean {
  const { kind, prefs, windowFocused, isOwnMessage } = options;
  if (isOwnMessage) return false;
  if (kind === 'dm' && !prefs.dms) return false;
  if (kind === 'group' && !prefs.groups) return false;
  if (prefs.onlyWhenUnfocused && windowFocused) return false;
  return true;
}

/** État de l'autorisation système (`unavailable` hors Tauri). */
export type NotificationPermission = 'granted' | 'denied' | 'unavailable';

/** Interroge l'autorisation courante sans rien demander à l'utilisateur. */
export async function queryNotificationPermission(): Promise<NotificationPermission> {
  if (!isTauri()) return 'unavailable';
  try {
    const { isPermissionGranted } = await import('@tauri-apps/plugin-notification');
    return (await isPermissionGranted()) ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/** Demande l'autorisation système (invite native le cas échéant). */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isTauri()) return 'unavailable';
  try {
    const plugin = await import('@tauri-apps/plugin-notification');
    if (await plugin.isPermissionGranted()) return 'granted';
    const outcome = await plugin.requestPermission();
    return outcome === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/**
 * Envoie une notification native si l'autorisation est accordée. Best effort :
 * hors Tauri ou sans autorisation, ne fait rien (aucune erreur remontée).
 */
export async function sendNativeNotification(title: string, body: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const plugin = await import('@tauri-apps/plugin-notification');
    if (!(await plugin.isPermissionGranted())) return;
    plugin.sendNotification({ title, body });
  } catch {
    // Best effort : une notification manquée ne doit pas casser l'app.
  }
}
