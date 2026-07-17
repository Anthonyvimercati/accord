/**
 * Tests de lireFichier : lecture directe, cache LRU borné (éviction du plus
 * ancien, rafraîchissement à l'accès), attente de `event.file_progress` sur
 * `{ pending: true }`, abandon sur silence, et reprises automatiques
 * (backoff) après un abandon signalé par le nœud (`complete: false` sans
 * avancée de `done`) — l'abonnement reste vivant à travers les reprises (un
 * `complete: true` tardif résout toujours). Tests de lireMiniature : repli
 * sur l'URL source quand le canvas est indisponible (jsdom) et cache dédié.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

type EventHandler = (method: string, params: unknown) => void;
const handlers = new Set<EventHandler>();

vi.mock('./client', () => ({
  rpc: {
    onEvent: vi.fn((handler: EventHandler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    }),
  },
  api: { filesRead: vi.fn() },
}));

import { api } from './client';
import {
  lireFichier,
  lireMiniature,
  FILE_CACHE_MAX,
  FILE_RETRY_BACKOFF_MS,
  FILE_WAIT_TIMEOUT_MS,
} from './files';

const readMock = api.filesRead as unknown as Mock;

/** Simule une notification `event.file_progress` du nœud. */
function pushProgress(merkleRoot: string, complete: boolean): void {
  pushEvent(merkleRoot, complete ? 4 : 1, complete);
}

/** Notification brute avec `done` contrôlé (progrès réel vs abandon stagnant). */
function pushEvent(merkleRoot: string, done: number, complete: boolean): void {
  for (const handler of handlers) {
    handler('event.file_progress', {
      merkle_root: merkleRoot,
      done,
      total: 4,
      complete,
    });
  }
}

/** Contenu complet rendu par files.read (data_b64 = « abc »). */
const COMPLETE = { data_b64: 'YWJj', name: 'a.png', mime: 'image/png', size: 3 };

/** URL data: attendue pour COMPLETE (blob: non rendue par WKWebView). */
const URL_ATTENDUE = 'data:image/png;base64,YWJj';

beforeEach(() => {
  readMock.mockReset();
  handlers.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('lireFichier', () => {
  it('rend une URL data: quand le fichier est complet en local', async () => {
    readMock.mockResolvedValueOnce(COMPLETE);

    const url = await lireFichier('hash-direct');

    expect(url).toBe(URL_ATTENDUE);
    // `media: true` : lecture en ligne plafonnée (anti-DoS média serveur).
    expect(readMock).toHaveBeenCalledWith('hash-direct', undefined, true);
  });

  it('met l’URL en cache : une seule lecture pour deux appels', async () => {
    readMock.mockResolvedValueOnce(COMPLETE);

    const first = await lireFichier('hash-cache');
    const second = await lireFichier('hash-cache');

    expect(second).toBe(first);
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('attend event.file_progress complet puis relit sur { pending }', async () => {
    readMock.mockResolvedValueOnce({ pending: true }).mockResolvedValueOnce(COMPLETE);

    const promise = lireFichier('hash-attente', 'pair-source');
    // Laisse la première lecture s'installer avant de pousser l'événement.
    await Promise.resolve();
    await Promise.resolve();
    pushProgress('hash-attente', true);

    await expect(promise).resolves.toBe(URL_ATTENDUE);
    expect(readMock).toHaveBeenCalledTimes(2);
    expect(readMock).toHaveBeenNthCalledWith(2, 'hash-attente', 'pair-source');
  });

  it('rejette après un silence prolongé du nœud (téléchargement abandonné)', async () => {
    vi.useFakeTimers();
    readMock.mockResolvedValueOnce({ pending: true });

    const promise = lireFichier('hash-silence');
    const failure = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(FILE_WAIT_TIMEOUT_MS + 1);

    await failure;
  });

  it('retire l’entrée du cache après un échec pour permettre une reprise', async () => {
    readMock.mockRejectedValueOnce(new Error('refusé : trop volumineux'));
    await expect(lireFichier('hash-reprise')).rejects.toThrow();

    readMock.mockResolvedValueOnce(COMPLETE);
    await expect(lireFichier('hash-reprise')).resolves.toBe(URL_ATTENDUE);
  });

  it('survit à un abandon signalé : un complete tardif résout pendant le backoff', async () => {
    vi.useFakeTimers();
    let fileComplete = false;
    readMock.mockImplementation(async () =>
      fileComplete ? COMPLETE : { pending: true },
    );

    const promise = lireFichier('hash-abandon');
    // Laisse la première lecture s'installer avant de pousser les événements.
    await Promise.resolve();
    await Promise.resolve();
    pushEvent('hash-abandon', 1, false); // progrès réel
    pushEvent('hash-abandon', 1, false); // done stagnant : abandon → backoff
    // Le nœud retente en arrière-plan et finit pendant le backoff :
    fileComplete = true;
    pushEvent('hash-abandon', 4, true);

    await expect(promise).resolves.toBe(URL_ATTENDUE);
  });

  it('rejette vite après deux reprises quand le nœud abandonne encore et encore', async () => {
    vi.useFakeTimers();
    readMock.mockResolvedValue({ pending: true });

    const promise = lireFichier('hash-abandons');
    const failure = expect(promise).rejects.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    pushEvent('hash-abandons', 1, false); // premier événement : progrès
    pushEvent('hash-abandons', 1, false); // abandon → reprise 1
    await vi.advanceTimersByTimeAsync((FILE_RETRY_BACKOFF_MS[0] ?? 0) + 1);
    pushEvent('hash-abandons', 1, false); // abandon → reprise 2
    await vi.advanceTimersByTimeAsync((FILE_RETRY_BACKOFF_MS[1] ?? 0) + 1);
    pushEvent('hash-abandons', 1, false); // reprises épuisées : rejet immédiat

    await failure;
    // Bien plus vite que le délai d'inactivité complet : les reprises sont
    // bornées par les backoffs courts, pas par FILE_WAIT_TIMEOUT_MS.
  });
});

describe('cache LRU de lireFichier', () => {
  it('évince le plus ancien au-delà de la capacité : le 65e évince le 1er', async () => {
    readMock.mockResolvedValue(COMPLETE);

    // Remplit le cache à sa capacité exacte : 64 hachages distincts.
    for (let i = 0; i < FILE_CACHE_MAX; i += 1) {
      await lireFichier(`hash-lru-${i}`);
    }
    expect(readMock).toHaveBeenCalledTimes(FILE_CACHE_MAX);

    // La 65e entrée dépasse la capacité : le 1er (hash-lru-0) est évincé…
    await lireFichier(`hash-lru-${FILE_CACHE_MAX}`);
    // …mais le 2e, encore en cache, est servi sans nouvelle lecture.
    await lireFichier('hash-lru-1');
    expect(readMock).toHaveBeenCalledTimes(FILE_CACHE_MAX + 1);

    // Relire le 1er déclenche une vraie lecture : il n'est plus en cache.
    await lireFichier('hash-lru-0');
    expect(readMock).toHaveBeenCalledTimes(FILE_CACHE_MAX + 2);
  });

  it('rafraîchit une entrée à l’accès : la relecture la protège de l’éviction', async () => {
    readMock.mockResolvedValue(COMPLETE);

    for (let i = 0; i < FILE_CACHE_MAX; i += 1) {
      await lireFichier(`hash-mru-${i}`);
    }
    // Accès au plus ancien : il redevient le plus récent (ré-insertion)…
    await lireFichier('hash-mru-0');
    expect(readMock).toHaveBeenCalledTimes(FILE_CACHE_MAX);

    // …donc l'entrée suivante évince hash-mru-1, pas hash-mru-0.
    await lireFichier(`hash-mru-${FILE_CACHE_MAX}`);
    await lireFichier('hash-mru-0');
    expect(readMock).toHaveBeenCalledTimes(FILE_CACHE_MAX + 1);
    await lireFichier('hash-mru-1');
    expect(readMock).toHaveBeenCalledTimes(FILE_CACHE_MAX + 2);
  });
});

describe('lireMiniature', () => {
  /** Neutralise le canvas comme le fait jsdom nu : pas de contexte 2d. */
  function sansCanvas(): () => void {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    return () => spy.mockRestore();
  }

  it('retombe sur l’URL source pleine taille quand le canvas est indisponible (jsdom)', async () => {
    const restaurer = sansCanvas();
    try {
      readMock.mockResolvedValueOnce(COMPLETE);

      const url = await lireMiniature('hash-mini-jsdom');

      expect(url).toBe(URL_ATTENDUE);
    } finally {
      restaurer();
    }
  });

  it('sert la miniature depuis son cache : une seule lecture source', async () => {
    const restaurer = sansCanvas();
    try {
      readMock.mockResolvedValueOnce(COMPLETE);

      const premiere = await lireMiniature('hash-mini-cache');
      const seconde = await lireMiniature('hash-mini-cache');

      expect(seconde).toBe(premiere);
      expect(readMock).toHaveBeenCalledTimes(1);
    } finally {
      restaurer();
    }
  });

  it('libère l’entrée après un échec de lecture pour permettre une reprise', async () => {
    const restaurer = sansCanvas();
    try {
      readMock.mockRejectedValueOnce(new Error('refusé : trop volumineux'));
      await expect(lireMiniature('hash-mini-echec')).rejects.toThrow();

      readMock.mockResolvedValueOnce(COMPLETE);
      await expect(lireMiniature('hash-mini-echec')).resolves.toBe(URL_ATTENDUE);
    } finally {
      restaurer();
    }
  });
});
