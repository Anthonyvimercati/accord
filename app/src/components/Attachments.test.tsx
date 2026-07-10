/**
 * Tests des pièces jointes dans le fil de messages : vignette d'image
 * (progression puis aperçu, plein écran), carte de fichier téléchargeable,
 * refus net au-delà de 8 Mio et message sans texte (pièces seules).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileAttachment } from '../lib/api';
import { MAX_TAILLE_PIECE } from '../lib/attachments';
import { useSession } from '../stores/session';
import { useUi } from '../stores/ui';
import { MessageList, type DisplayMessage } from './MessageList';

vi.mock('../lib/files', () => ({
  lireFichier: vi.fn(),
  statutFichier: vi.fn(async () => ({
    known: false,
    complete: false,
    done: 0,
    total: 0,
  })),
  observerProgression: vi.fn(() => () => {}),
}));

import { lireFichier, observerProgression, statutFichier } from '../lib/files';

const lireMock = lireFichier as unknown as Mock;
const statutMock = statutFichier as unknown as Mock;
const observerMock = observerProgression as unknown as Mock;

const BASE_MS = new Date('2026-07-08T10:00:00').getTime();

function piece(over: Partial<FileAttachment> = {}): FileAttachment {
  return {
    merkle_root: 'ab'.repeat(32),
    name: 'photo.png',
    size: 2048,
    mime: 'image/png',
    ...over,
  };
}

function message(attachments: FileAttachment[], text = 'regarde'): DisplayMessage {
  return {
    msg_id: 'm1',
    author: 'aabbccddee',
    sent_ms: BASE_MS,
    deleted: false,
    body: { type: 'text', text, reply_to: null, attachments: attachments.length },
    edited: null,
    attachments,
  };
}

beforeEach(() => {
  useUi.setState({ lang: 'fr' });
  useSession.setState({ self: null });
  lireMock.mockReset();
  statutMock.mockClear();
  observerMock.mockClear();
});

describe('Pièces jointes — vignette d’image', () => {
  it('affiche la vignette une fois le blob lu (hint = expéditeur)', async () => {
    lireMock.mockResolvedValueOnce('blob:image');
    render(<MessageList messages={[message([piece()])]} />);

    expect(await screen.findByAltText('photo.png')).toHaveAttribute('src', 'blob:image');
    expect(lireMock).toHaveBeenCalledWith('ab'.repeat(32), 'aabbccddee');
  });

  it('montre la progression pendant le téléchargement', async () => {
    lireMock.mockReturnValueOnce(new Promise(() => {}));
    statutMock.mockResolvedValueOnce({ known: true, complete: false, done: 1, total: 4 });
    render(<MessageList messages={[message([piece()])]} />);

    expect(await screen.findByText('Téléchargement… 25 %')).toBeInTheDocument();
    expect(observerMock).toHaveBeenCalledWith('ab'.repeat(32), expect.any(Function));
  });

  it('ouvre le plein écran au clic et le ferme par Échap', async () => {
    lireMock.mockResolvedValueOnce('blob:image');
    render(<MessageList messages={[message([piece()])]} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Agrandir photo.png' }));
    expect(screen.getByRole('dialog', { name: 'photo.png' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('signale une image indisponible sans casser le fil', async () => {
    lireMock.mockRejectedValueOnce(new Error('introuvable'));
    render(<MessageList messages={[message([piece()])]} />);

    expect(await screen.findByText('Image indisponible')).toBeInTheDocument();
  });

  it('rend un message sans texte (pièces jointes seules)', async () => {
    lireMock.mockResolvedValueOnce('blob:image');
    render(<MessageList messages={[message([piece()], '')]} />);

    expect(await screen.findByAltText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('aabbcc')).toBeInTheDocument();
  });
});

describe('Pièces jointes — carte de fichier', () => {
  it('affiche nom, taille lisible et bouton de téléchargement', () => {
    render(
      <MessageList
        messages={[message([piece({ name: 'doc.pdf', mime: 'application/pdf' })])]}
      />,
    );

    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 Ko')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Télécharger doc.pdf' })).toBeEnabled();
    // Pas de lecture avant le clic : le téléchargement est à la demande.
    expect(lireMock).not.toHaveBeenCalled();
  });

  it('télécharge via lireFichier au clic (lien download)', async () => {
    lireMock.mockResolvedValueOnce('blob:doc');
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    render(
      <MessageList
        messages={[message([piece({ name: 'doc.pdf', mime: 'application/pdf' })])]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Télécharger doc.pdf' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(lireMock).toHaveBeenCalledWith('ab'.repeat(32), 'aabbccddee');
    clickSpy.mockRestore();
  });

  it('désactive le téléchargement au-delà de 8 Mio avec explication', () => {
    render(
      <MessageList
        messages={[
          message([
            piece({
              name: 'enorme.zip',
              mime: 'application/zip',
              size: MAX_TAILLE_PIECE + 1,
            }),
          ]),
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Télécharger enorme.zip' })).toBeDisabled();
    expect(
      screen.getByText('Téléchargement impossible : au-delà de la limite de 8 Mio'),
    ).toBeInTheDocument();
  });

  it('replie une image trop volumineuse en carte « trop volumineux »', () => {
    render(<MessageList messages={[message([piece({ size: MAX_TAILLE_PIECE + 1 })])]} />);

    expect(screen.queryByAltText('photo.png')).not.toBeInTheDocument();
    expect(screen.getByText(/Trop volumineux pour l’aperçu/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Télécharger photo.png' })).toBeDisabled();
  });
});
