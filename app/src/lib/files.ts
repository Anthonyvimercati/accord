/**
 * Lecture de fichiers du magasin (`files.read`) : rend une URL `data:`
 * affichable, avec cache module-scope hash → URL. Les URL `blob:`
 * (`URL.createObjectURL`) ne sont pas rendues par la WKWebView de l'app
 * packagée (Tauri/macOS) — images cassées malgré une CSP `img-src blob:`
 * correcte ; les URL `data:` s'affichent partout.
 *
 * Si le contenu n'est pas complet en local, le nœud rend `{ pending: true }`
 * et lance le téléchargement : on attend alors `event.file_progress` avec
 * `complete: true` (délai glissant, réarmé à chaque progression) avant de
 * relire. Un silence prolongé (abandon compris) rejette la promesse — elle
 * est alors retirée du cache pour permettre une nouvelle tentative.
 */

import { api, rpc } from './client';
import type { FilesReadResult, FilesStatusResult } from './api';

/** Délai glissant sans progression avant abandon de l'attente. */
export const FILE_WAIT_TIMEOUT_MS = 30_000;

/** Cache module-scope : la promesse est partagée entre appels concurrents. */
const cache = new Map<string, Promise<string>>();

/** Octets base64 → URL `data:` affichable (compatible WKWebView). */
function toDataUrl(dataB64: string, mime: string): string {
  return `data:${mime};base64,${dataB64}`;
}

/**
 * Attend la fin du téléchargement de `merkleRoot` (`complete: true`).
 * Chaque événement de progression réarme le délai ; sans nouvelle du nœud
 * pendant `FILE_WAIT_TIMEOUT_MS` (téléchargement abandonné ou pair injoignable),
 * la promesse rejette.
 */
function waitForDownload(merkleRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const off = rpc.onEvent((method, params) => {
      if (method !== 'event.file_progress') return;
      const p = params as { merkle_root?: string; complete?: boolean };
      if (p.merkle_root !== merkleRoot) return;
      if (p.complete === true) {
        clearTimeout(timer);
        off();
        resolve();
        return;
      }
      // Progression : on réarme le délai d'inactivité.
      clearTimeout(timer);
      timer = arm();
    });
    const arm = (): ReturnType<typeof setTimeout> =>
      setTimeout(() => {
        off();
        reject(new Error('téléchargement du fichier interrompu'));
      }, FILE_WAIT_TIMEOUT_MS);
    timer = arm();
  });
}

async function fetchDataUrl(merkleRoot: string, hint?: string): Promise<string> {
  const first: FilesReadResult = await api.filesRead(merkleRoot, hint);
  if (first.pending !== true) return toDataUrl(first.data_b64, first.mime);
  await waitForDownload(merkleRoot);
  const second: FilesReadResult = await api.filesRead(merkleRoot, hint);
  if (second.pending === true) {
    throw new Error('fichier toujours incomplet après téléchargement');
  }
  return toDataUrl(second.data_b64, second.mime);
}

/**
 * Lit un fichier par sa racine Merkle et rend une URL `data:` réutilisable.
 * `hint` : clé publique d'un pair source probable (expéditeur du message).
 */
export function lireFichier(merkleRoot: string, hint?: string): Promise<string> {
  const cached = cache.get(merkleRoot);
  if (cached !== undefined) return cached;
  const promise = fetchDataUrl(merkleRoot, hint);
  cache.set(merkleRoot, promise);
  // Échec : on libère l'entrée pour qu'une prochaine lecture retente.
  promise.catch(() => cache.delete(merkleRoot));
  return promise;
}

/** Métadonnées et progression locales d'un fichier (`files.status`). */
export function statutFichier(
  merkleRoot: string,
  hint?: string,
): Promise<FilesStatusResult> {
  return api.filesStatus(merkleRoot, hint);
}

/**
 * Suit la progression du téléchargement de `merkleRoot` : `onProgress` est
 * appelé à chaque `event.file_progress` du nœud. Rend le désabonnement.
 */
export function observerProgression(
  merkleRoot: string,
  onProgress: (done: number, total: number, complete: boolean) => void,
): () => void {
  return rpc.onEvent((method, params) => {
    if (method !== 'event.file_progress') return;
    const p = params as {
      merkle_root?: string;
      done?: number;
      total?: number;
      complete?: boolean;
    };
    if (p.merkle_root !== merkleRoot) return;
    onProgress(p.done ?? 0, p.total ?? 0, p.complete === true);
  });
}
