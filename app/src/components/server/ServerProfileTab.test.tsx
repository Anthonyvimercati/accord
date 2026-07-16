/**
 * Tests de la section bannière de l'onglet Profil du serveur : validation
 * locale du fichier (MIME image, ≤ 512 Kio) avec toast d'erreur, envoi via
 * `setBanner` (→ groups.set_banner), retrait, et masquage des contrôles
 * sans MANAGE_CHANNELS.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GroupStateJson } from '../../lib/api';
import { PERMISSIONS, useGroups } from '../../stores/groups';
import { useUi } from '../../stores/ui';
import { ServerProfileTab } from './ServerProfileTab';

vi.mock('../../lib/files', () => ({
  lireFichier: vi.fn(() => new Promise(() => {})),
}));

const BANNER_HASH = 'ab'.repeat(32);

function groupState(over: Partial<GroupStateJson> = {}): GroupStateJson {
  return {
    group_id: 'g1',
    name: 'Guilde',
    icon: null,
    banner: null,
    founder: null,
    members: [],
    bans: [],
    channels: [],
    categories: [],
    roles: [],
    invites: [],
    my_permissions: PERMISSIONS.VIEW | PERMISSIONS.SEND | PERMISSIONS.MANAGE_CHANNELS,
    ...over,
  };
}

function seed(state: GroupStateJson): { setBanner: ReturnType<typeof vi.fn> } {
  const setBanner = vi.fn(async () => {});
  useGroups.setState({
    states: { g1: state },
    setBanner,
    setIcon: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    setBannerColor: vi.fn(async () => {}),
  });
  return { setBanner };
}

/** Change simulé de l'input fichier de la section bannière. */
function chooseFile(file: File): void {
  const input = screen.getByLabelText('Choisir une bannière');
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  useUi.setState({ lang: 'fr', toasts: [] });
});

describe('ServerProfileTab — bannière du serveur', () => {
  it('refuse un fichier non image avec un toast d’erreur, sans appel réseau', async () => {
    // Arrange
    const { setBanner } = seed(groupState());
    render(<ServerProfileTab groupId="g1" />);

    // Act
    chooseFile(new File(['abc'], 'notes.txt', { type: 'text/plain' }));

    // Assert
    await waitFor(() => {
      expect(
        useUi
          .getState()
          .toasts.some(
            (t) => t.kind === 'error' && t.text === 'Ce fichier n’est pas une image.',
          ),
      ).toBe(true);
    });
    expect(setBanner).not.toHaveBeenCalled();
  });

  it('refuse une image de plus de 512 Kio avec un toast d’erreur', async () => {
    // Arrange
    const { setBanner } = seed(groupState());
    render(<ServerProfileTab groupId="g1" />);

    // Act
    chooseFile(
      new File([new Uint8Array(512 * 1024 + 1)], 'grande.png', { type: 'image/png' }),
    );

    // Assert
    await waitFor(() => {
      expect(
        useUi
          .getState()
          .toasts.some(
            (t) =>
              t.kind === 'error' && t.text === 'Image trop lourde (512 Kio maximum).',
          ),
      ).toBe(true);
    });
    expect(setBanner).not.toHaveBeenCalled();
  });

  it('publie une image valide via setBanner (base64 + MIME) et confirme', async () => {
    // Arrange
    const { setBanner } = seed(groupState());
    render(<ServerProfileTab groupId="g1" />);

    // Act
    chooseFile(new File(['abc'], 'banniere.png', { type: 'image/png' }));

    // Assert — « abc » encodé en base64 = « YWJj ».
    await waitFor(() =>
      expect(setBanner).toHaveBeenCalledWith('g1', 'YWJj', 'image/png'),
    );
    await waitFor(() => {
      expect(
        useUi
          .getState()
          .toasts.some((t) => t.kind === 'info' && /Bannière mise à jour/.test(t.text)),
      ).toBe(true);
    });
  });

  it('ne propose le retrait qu’avec une bannière, et retire via setBanner(null)', async () => {
    // Arrange
    const { setBanner } = seed(groupState({ banner: BANNER_HASH }));
    render(<ServerProfileTab groupId="g1" />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Retirer la bannière' }));

    // Assert
    await waitFor(() => expect(setBanner).toHaveBeenCalledWith('g1', null, null));
    await waitFor(() => {
      expect(
        useUi
          .getState()
          .toasts.some((t) => t.kind === 'info' && /Bannière retirée/.test(t.text)),
      ).toBe(true);
    });
  });

  it('masque le bouton Retirer tant qu’aucune bannière n’est définie', () => {
    seed(groupState());
    render(<ServerProfileTab groupId="g1" />);

    expect(
      screen.queryByRole('button', { name: 'Retirer la bannière' }),
    ).not.toBeInTheDocument();
  });

  it('masque les contrôles de bannière sans MANAGE_CHANNELS', () => {
    seed(groupState({ my_permissions: PERMISSIONS.VIEW | PERMISSIONS.SEND }));
    render(<ServerProfileTab groupId="g1" />);

    expect(screen.queryByLabelText('Choisir une bannière')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Choisir une bannière' }),
    ).not.toBeInTheDocument();
  });
});
