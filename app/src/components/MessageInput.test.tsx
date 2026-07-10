/**
 * Tests de la zone de saisie avec pièces jointes : aperçus retirables,
 * bornes UI (10 pièces, 8 Mio), publication via files.share_bytes à l'envoi
 * (texte vide admis), collage de fichiers et signalement des échecs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MAX_TAILLE_PIECE } from '../lib/attachments';
import { useUi } from '../stores/ui';
import { MessageInput } from './MessageInput';

vi.mock('../lib/client', () => ({
  rpc: { onEvent: vi.fn(() => () => {}) },
  api: { filesShareBytes: vi.fn() },
}));

import { api } from '../lib/client';

const shareMock = api.filesShareBytes as unknown as Mock;

beforeEach(() => {
  useUi.setState({ lang: 'fr' });
  shareMock.mockReset();
});

function renderInput(onSend = vi.fn(async () => {})) {
  render(<MessageInput placeholder="Écrire à @Alice" onSend={onSend} />);
  return onSend;
}

function addFiles(files: File[]): void {
  fireEvent.change(screen.getByLabelText('Joindre des fichiers', { selector: 'input' }), {
    target: { files },
  });
}

const IMAGE = new File(['ABC'], 'photo.png', { type: 'image/png' });
const PDF = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });

describe('MessageInput — aperçus', () => {
  it('affiche nom et taille du fichier ajouté, vignette data: pour une image', async () => {
    renderInput();
    addFiles([IMAGE, PDF]);

    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(screen.getByText('4 o')).toBeInTheDocument();
    // L'aperçu arrive après lecture du fichier (FileReader asynchrone).
    const vignette = await screen.findByAltText('photo.png');
    expect(vignette.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('retire une pièce de la liste', () => {
    renderInput();
    addFiles([IMAGE]);

    fireEvent.click(screen.getByLabelText('Retirer photo.png'));

    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
  });

  it('ajoute les fichiers collés depuis le presse-papiers', () => {
    renderInput();

    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: { files: [IMAGE] },
    });

    expect(screen.getByText('photo.png')).toBeInTheDocument();
  });
});

describe('MessageInput — bornes', () => {
  it('refuse un fichier au-delà de 8 Mio avec un message clair', () => {
    renderInput();
    const gros = new File([new ArrayBuffer(MAX_TAILLE_PIECE + 1)], 'gros.bin');
    addFiles([gros]);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '« gros.bin » dépasse la limite de 8 Mio',
    );
    expect(screen.queryByText('gros.bin')).not.toBeInTheDocument();
  });

  it('refuse au-delà de 10 pièces par message', () => {
    renderInput();
    const fichiers = Array.from(
      { length: 11 },
      (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' }),
    );
    addFiles(fichiers);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '10 pièces jointes au maximum par message',
    );
    expect(screen.getByText('f9.txt')).toBeInTheDocument();
    expect(screen.queryByText('f10.txt')).not.toBeInTheDocument();
  });
});

describe('MessageInput — envoi', () => {
  it('publie chaque pièce puis envoie le message avec les références', async () => {
    const piece = {
      merkle_root: 'ab'.repeat(32),
      name: 'photo.png',
      size: 3,
      mime: 'image/png',
    };
    shareMock.mockResolvedValueOnce({ file: piece });
    const onSend = renderInput();

    addFiles([IMAGE]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'regarde !' } });
    fireEvent.click(screen.getByLabelText('Envoyer'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('regarde !', [piece]));
    expect(shareMock).toHaveBeenCalledWith('photo.png', 'image/png', 'QUJD');
    // Les aperçus sont vidés après l'envoi.
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
  });

  it('autorise l’envoi sans texte quand il y a des pièces jointes', async () => {
    shareMock.mockResolvedValueOnce({
      file: {
        merkle_root: 'cd'.repeat(32),
        name: 'doc.pdf',
        size: 4,
        mime: 'application/pdf',
      },
    });
    const onSend = renderInput();

    addFiles([PDF]);
    const envoyer = screen.getByLabelText('Envoyer');
    expect(envoyer).toBeEnabled();
    fireEvent.click(envoyer);

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith('', [
        expect.objectContaining({ name: 'doc.pdf' }),
      ]),
    );
  });

  it('interdit l’envoi sans texte ni pièce jointe', () => {
    renderInput();

    expect(screen.getByLabelText('Envoyer')).toBeDisabled();
  });

  it('n’appelle pas files.share_bytes pour un envoi sans pièce', async () => {
    const onSend = renderInput();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bonjour' } });
    fireEvent.click(screen.getByLabelText('Envoyer'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('bonjour', undefined));
    expect(shareMock).not.toHaveBeenCalled();
  });

  it('signale l’échec de publication et conserve la saisie', async () => {
    shareMock.mockRejectedValueOnce(new Error('trop volumineux'));
    const onSend = renderInput();

    addFiles([IMAGE]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'oups' } });
    fireEvent.click(screen.getByLabelText('Envoyer'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Échec de l’envoi'),
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('oups');
    expect(screen.getByText('photo.png')).toBeInTheDocument();
  });
});
