/**
 * Tests du recadreur : ouverture après chargement de l'image, réglage du
 * zoom via le curseur, validation appelant le callback avec un data_b64,
 * annulation (bouton et Échap) et image illisible. jsdom ne charge pas
 * d'images ni de canvas : on simule le chargement et l'encodage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useUi } from '../stores/ui';
import { AvatarCropper } from './AvatarCropper';

/** Simule le chargement d'une image (dimensions fixes) ou son échec. */
function stubImage(largeur: number, hauteur: number, echoue = false): void {
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(largeur);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(hauteur);
  vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (
    this: HTMLImageElement,
  ) {
    setTimeout(() => {
      if (echoue) this.onerror?.(new Event('error'));
      else this.onload?.(new Event('load'));
    }, 0);
  });
}

beforeEach(() => {
  useUi.setState({ lang: 'fr' });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,QUJD',
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const fichier = new File(['x'], 'photo.png', { type: 'image/png' });

describe('AvatarCropper', () => {
  it('affiche le dialogue et le curseur de zoom après chargement', async () => {
    stubImage(800, 500);
    render(
      <AvatarCropper
        fichier={fichier}
        forme="cercle"
        onAnnuler={vi.fn()}
        onValider={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Recadrer l’avatar' })).toBeInTheDocument();
    expect(await screen.findByRole('slider', { name: 'Zoom' })).toBeInTheDocument();
  });

  it('intitule le dialogue « icône » pour la forme carrée', async () => {
    stubImage(600, 600);
    render(
      <AvatarCropper
        fichier={fichier}
        forme="carre"
        onAnnuler={vi.fn()}
        onValider={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Recadrer l’icône' })).toBeInTheDocument();
  });

  it('ajuste le zoom via le curseur', async () => {
    stubImage(800, 500);
    render(
      <AvatarCropper
        fichier={fichier}
        forme="cercle"
        onAnnuler={vi.fn()}
        onValider={vi.fn()}
      />,
    );

    const slider = await screen.findByRole('slider', { name: 'Zoom' });
    await waitFor(() => expect(slider).toBeEnabled());
    fireEvent.change(slider, { target: { value: '2' } });

    expect(slider).toHaveValue('2');
  });

  it('valide en appelant le callback avec un data_b64 recadré', async () => {
    stubImage(800, 500);
    const onValider = vi.fn();
    render(
      <AvatarCropper
        fichier={fichier}
        forme="cercle"
        onAnnuler={vi.fn()}
        onValider={onValider}
      />,
    );

    // Le chargement passe par FileReader puis Image : attendre l'état prêt.
    const slider = await screen.findByRole('slider', { name: 'Zoom' });
    await waitFor(() => expect(slider).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));

    await waitFor(() =>
      expect(onValider).toHaveBeenCalledWith(
        expect.objectContaining({ dataB64: 'QUJD', mime: 'image/png' }),
      ),
    );
  });

  it('annule via le bouton et via la touche Échap', async () => {
    stubImage(800, 500);
    const onAnnuler = vi.fn();
    render(
      <AvatarCropper
        fichier={fichier}
        forme="cercle"
        onAnnuler={onAnnuler}
        onValider={vi.fn()}
      />,
    );

    await screen.findByRole('slider', { name: 'Zoom' });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onAnnuler).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onAnnuler).toHaveBeenCalledTimes(2);
  });

  it('signale une image illisible et bloque la validation', async () => {
    stubImage(800, 500, true);
    render(
      <AvatarCropper
        fichier={fichier}
        forme="cercle"
        onAnnuler={vi.fn()}
        onValider={vi.fn()}
      />,
    );

    expect(
      await screen.findByText('Ce fichier n’est pas une image exploitable'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled();
  });
});
