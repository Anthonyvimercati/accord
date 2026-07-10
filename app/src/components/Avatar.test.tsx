/**
 * Tests de l'avatar : repli initiales + couleur sans hash, image chargée via
 * lireFichier quand un hash est fourni, repli pendant le chargement et en
 * cas d'échec (image indisponible).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Avatar } from './Avatar';

vi.mock('../lib/files', () => ({ lireFichier: vi.fn() }));

import { lireFichier } from '../lib/files';

const lireMock = lireFichier as unknown as Mock;
const HASH = 'ab'.repeat(32);

beforeEach(() => {
  lireMock.mockReset();
});

describe('Avatar', () => {
  it('affiche les initiales sans hash, sans lire le magasin', () => {
    render(<Avatar id="aabbcc" name="Alice Bob" />);

    expect(screen.getByText('AB')).toBeInTheDocument();
    expect(lireMock).not.toHaveBeenCalled();
  });

  it('affiche l’image une fois le blob lu (hint transmis)', async () => {
    lireMock.mockResolvedValueOnce('blob:avatar');
    const { container } = render(
      <Avatar id="aabbcc" name="Alice" avatarHash={HASH} hint="alice-pk" />,
    );

    await waitFor(() => {
      expect(container.querySelector('img')).toHaveAttribute('src', 'blob:avatar');
    });
    expect(lireMock).toHaveBeenCalledWith(HASH, 'alice-pk');
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('garde les initiales pendant le chargement', () => {
    lireMock.mockReturnValueOnce(new Promise(() => {}));
    const { container } = render(<Avatar id="aabbcc" name="Alice" avatarHash={HASH} />);

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('retombe sur les initiales quand la lecture échoue', async () => {
    lireMock.mockRejectedValueOnce(new Error('introuvable'));
    const { container } = render(<Avatar id="aabbcc" name="Alice" avatarHash={HASH} />);

    await waitFor(() => expect(lireMock).toHaveBeenCalled());
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('recharge l’image quand le hash change', async () => {
    lireMock.mockResolvedValue('blob:v1');
    const { rerender } = render(<Avatar id="x" name="Alice" avatarHash={HASH} />);
    await waitFor(() => expect(lireMock).toHaveBeenCalledTimes(1));

    rerender(<Avatar id="x" name="Alice" avatarHash={'cd'.repeat(32)} />);

    await waitFor(() => expect(lireMock).toHaveBeenCalledTimes(2));
    expect(lireMock).toHaveBeenLastCalledWith('cd'.repeat(32), undefined);
  });
});
