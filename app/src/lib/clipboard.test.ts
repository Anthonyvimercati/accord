/**
 * Tests de la copie presse-papiers best effort : succès, rejet de la promesse
 * et absence/erreur synchrone de l'API — chaque échec doit appeler `onError`
 * sans jamais lever.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './clipboard';

const original = navigator.clipboard;

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: original,
    configurable: true,
  });
  vi.restoreAllMocks();
});

function stubClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

describe('copyToClipboard', () => {
  it('appelle onSuccess quand l’écriture réussit', async () => {
    stubClipboard(() => Promise.resolve());
    const onSuccess = vi.fn();
    const onError = vi.fn();
    copyToClipboard('x', onSuccess, onError);
    await Promise.resolve();
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('appelle onError quand la promesse est rejetée', async () => {
    stubClipboard(() => Promise.reject(new Error('refus')));
    const onError = vi.fn();
    copyToClipboard('x', vi.fn(), onError);
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('appelle onError sans lever quand l’API jette de façon synchrone', () => {
    stubClipboard(() => {
      throw new Error('indisponible');
    });
    const onError = vi.fn();
    expect(() => copyToClipboard('x', vi.fn(), onError)).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });
});
