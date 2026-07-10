/**
 * Copie presse-papiers en best effort : l'API `navigator.clipboard` peut être
 * absente ou refusée (environnement restreint) — l'échec est silencieux côté
 * exception, signalé à l'appelant via `onError` pour un retour utilisateur
 * (toast). Même garde que l'ancien `copyLink` de `MessageList`, généralisée
 * pour tous les usages « Copier … » du menu contextuel.
 */
export function copyToClipboard(text: string, onSuccess: () => void, onError: () => void): void {
  try {
    void navigator.clipboard.writeText(text).then(onSuccess).catch(onError);
  } catch {
    onError();
  }
}
