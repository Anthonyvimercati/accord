/**
 * Tests de lireFichier : lecture directe, cache module-scope, attente de
 * `event.file_progress` sur `{ pending: true }` et abandon sur silence.
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
import { lireFichier, FILE_WAIT_TIMEOUT_MS } from './files';

const readMock = api.filesRead as unknown as Mock;

/** Simule une notification `event.file_progress` du nœud. */
function pushProgress(merkleRoot: string, complete: boolean): void {
  for (const handler of handlers) {
    handler('event.file_progress', {
      merkle_root: merkleRoot,
      done: complete ? 4 : 1,
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
    expect(readMock).toHaveBeenCalledWith('hash-direct', undefined);
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
});
