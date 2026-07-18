/**
 * Glisser-déposer (branche navigateur) : voile pendant le survol de fichiers,
 * dépôt → callback avec les objets File, glisser de texte ignoré.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeposeFichiers } from './useDeposeFichiers';

function evenement(
  type: string,
  dataTransfer: { types: string[]; files?: File[] },
): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', {
    value: {
      types: dataTransfer.types,
      files: dataTransfer.files ?? [],
    },
  });
  return e;
}

const surFichiers = vi.fn();
const surChemins = vi.fn();

beforeEach(() => {
  surFichiers.mockClear();
  surChemins.mockClear();
});

describe('useDeposeFichiers (navigateur)', () => {
  it('signale le survol de fichiers puis livre le dépôt', () => {
    const { result } = renderHook(() =>
      useDeposeFichiers({ actif: true, surFichiers, surChemins }),
    );
    expect(result.current.glisse).toBe(false);

    act(() => {
      window.dispatchEvent(evenement('dragenter', { types: ['Files'] }));
    });
    expect(result.current.glisse).toBe(true);

    const fichier = new File(['octets'], 'photo.png', { type: 'image/png' });
    act(() => {
      window.dispatchEvent(evenement('drop', { types: ['Files'], files: [fichier] }));
    });
    expect(result.current.glisse).toBe(false);
    expect(surFichiers).toHaveBeenCalledWith([fichier]);
  });

  it('ignore un glisser de texte', () => {
    const { result } = renderHook(() =>
      useDeposeFichiers({ actif: true, surFichiers, surChemins }),
    );

    act(() => {
      window.dispatchEvent(evenement('dragenter', { types: ['text/plain'] }));
      window.dispatchEvent(evenement('drop', { types: ['text/plain'] }));
    });
    expect(result.current.glisse).toBe(false);
    expect(surFichiers).not.toHaveBeenCalled();
  });

  it('inactif : survol et dépôt sans effet', () => {
    const { result } = renderHook(() =>
      useDeposeFichiers({ actif: false, surFichiers, surChemins }),
    );

    const fichier = new File(['octets'], 'photo.png', { type: 'image/png' });
    act(() => {
      window.dispatchEvent(evenement('dragenter', { types: ['Files'] }));
      window.dispatchEvent(evenement('drop', { types: ['Files'], files: [fichier] }));
    });
    expect(result.current.glisse).toBe(false);
    expect(surFichiers).not.toHaveBeenCalled();
  });

  it('le voile retombe quand le glisser ressort de la fenêtre', () => {
    const { result } = renderHook(() =>
      useDeposeFichiers({ actif: true, surFichiers, surChemins }),
    );

    act(() => {
      window.dispatchEvent(evenement('dragenter', { types: ['Files'] }));
      window.dispatchEvent(evenement('dragleave', { types: ['Files'] }));
    });
    expect(result.current.glisse).toBe(false);
  });
});
