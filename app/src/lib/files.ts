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
 * relire. Un abandon signalé par le nœud (événement `complete: false` sans
 * avancée de `done`) fait échouer l'attente en cours rapidement, mais deux
 * reprises automatiques (backoff court) sont tentées avant de rejeter — le
 * nœud retente lui-même en arrière-plan, et l'abonnement reste vivant à
 * travers les reprises (un `complete: true` tardif résout toujours). Un
 * silence prolongé rejette ; la promesse est alors retirée du cache pour
 * permettre une nouvelle tentative.
 */

import { api, rpc } from './client';
import type { FilesReadResult, FilesStatusResult } from './api';

/** Délai glissant sans progression avant abandon de l'attente. */
export const FILE_WAIT_TIMEOUT_MS = 30_000;

/** Backoffs des reprises automatiques après un abandon signalé par le nœud. */
export const FILE_RETRY_BACKOFF_MS = [2_000, 5_000] as const;

/** Cache module-scope : la promesse est partagée entre appels concurrents. */
const cache = new Map<string, Promise<string>>();

/** Octets base64 → URL `data:` affichable (compatible WKWebView). */
function toDataUrl(dataB64: string, mime: string): string {
  return `data:${mime};base64,${dataB64}`;
}

/**
 * Attend la fin du téléchargement de `merkleRoot` (`complete: true`).
 *
 * - Une progression réelle (`done` qui avance) réarme le délai d'inactivité.
 * - Un abandon signalé (`complete: false` sans avancée de `done` — le nœud
 *   ré-émet l'état courant quand il diffère la tentative) fait échouer
 *   l'attente en cours SANS attendre le délai complet : après un court
 *   backoff (`FILE_RETRY_BACKOFF_MS`), l'intention est re-signalée au nœud
 *   (`files.read`) et une nouvelle fenêtre d'attente s'ouvre. L'abonnement
 *   reste vivant pendant le backoff : un `complete: true` tardif résout.
 * - Reprises épuisées (ou silence prolongé) : la promesse rejette.
 */
function waitForDownload(merkleRoot: string, hint?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastDone = -1;
    let retriesLeft: number = FILE_RETRY_BACKOFF_MS.length;
    let settled = false;
    const finish = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      off();
      if (err === null) resolve();
      else reject(err);
    };
    const arm = (ms: number, onExpire: () => void): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(onExpire, ms);
    };
    const expire = (): void =>
      finish(new Error('téléchargement du fichier interrompu'));
    /** Échec de l'attente en cours : reprise avec backoff, ou rejet. */
    const attemptFailed = (): void => {
      if (retriesLeft === 0) {
        finish(new Error('téléchargement du fichier interrompu'));
        return;
      }
      const backoff =
        FILE_RETRY_BACKOFF_MS[FILE_RETRY_BACKOFF_MS.length - retriesLeft] ?? 0;
      retriesLeft -= 1;
      arm(backoff, () => {
        // Re-signale l'intention au nœud ; s'il a fini entre-temps
        // (événement manqué), on résout tout de suite.
        api
          .filesRead(merkleRoot, hint, true)
          .then((r: FilesReadResult) => {
            if (r.pending !== true) finish(null);
          })
          .catch(() => {
            // Relance impossible : le délai d'inactivité tranchera.
          });
        arm(FILE_WAIT_TIMEOUT_MS, expire);
      });
    };
    const off = rpc.onEvent((method, params) => {
      if (method !== 'event.file_progress') return;
      const p = params as { merkle_root?: string; done?: number; complete?: boolean };
      if (p.merkle_root !== merkleRoot) return;
      if (p.complete === true) {
        finish(null);
        return;
      }
      const done = p.done ?? 0;
      if (done > lastDone) {
        // Progression réelle : on réarme le délai d'inactivité.
        lastDone = done;
        arm(FILE_WAIT_TIMEOUT_MS, expire);
        return;
      }
      // `done` stagnant + `complete: false` : abandon signalé par le nœud.
      attemptFailed();
    });
    arm(FILE_WAIT_TIMEOUT_MS, expire);
  });
}

async function fetchDataUrl(merkleRoot: string, hint?: string): Promise<string> {
  // `media: true` : la lecture en ligne (`lireFichier`) est bornée à 8 Mio,
  // donc le téléchargement déclenché est plafonné d'autant (anti-DoS média).
  const first: FilesReadResult = await api.filesRead(merkleRoot, hint, true);
  if (first.pending !== true) return toDataUrl(first.data_b64, first.mime);
  await waitForDownload(merkleRoot, hint);
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
