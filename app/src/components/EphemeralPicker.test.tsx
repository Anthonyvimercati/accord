/**
 * Disappearing-message picker tests: loads the current TTL, arms/disarms it
 * through the DM and group RPCs, rolls back on failure (section variant),
 * and opens/closes its popover (header variant).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../lib/client', () => ({
  rpc: { onEvent: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) },
  api: {
    dmGetEphemeral: vi.fn(),
    dmSetEphemeral: vi.fn(() => Promise.resolve({ ok: true })),
    groupsGetEphemeral: vi.fn(),
    groupsSetEphemeral: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

import { api } from '../lib/client';
import { useUi } from '../stores/ui';
import { EphemeralPicker } from './EphemeralPicker';

const dmGetMock = api.dmGetEphemeral as unknown as Mock;
const dmSetMock = api.dmSetEphemeral as unknown as Mock;
const groupGetMock = api.groupsGetEphemeral as unknown as Mock;
const groupSetMock = api.groupsSetEphemeral as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ lang: 'fr' });
  dmGetMock.mockResolvedValue({ ttl_secs: null });
  groupGetMock.mockResolvedValue({ ttl_secs: null });
});

describe('EphemeralPicker — section variant (group scope)', () => {
  it('loads the current TTL and shows it selected', async () => {
    groupGetMock.mockResolvedValue({ ttl_secs: 86_400 });
    render(
      <EphemeralPicker scope={{ kind: 'group', groupId: 'g1' }} variant="section" />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '24 heures' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    expect(groupGetMock).toHaveBeenCalledWith('g1');
  });

  it('arms a timer then disarms it through the group RPC', async () => {
    render(
      <EphemeralPicker scope={{ kind: 'group', groupId: 'g1' }} variant="section" />,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Désactivés' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '1 heure' }));
    await waitFor(() => {
      expect(groupSetMock).toHaveBeenCalledWith('g1', 3600);
    });
    expect(screen.getByRole('button', { name: '1 heure' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Désactivés' }));
    await waitFor(() => {
      expect(groupSetMock).toHaveBeenCalledWith('g1', null);
    });
  });

  it('rolls back the optimistic choice when the node refuses', async () => {
    groupSetMock.mockRejectedValue(new Error('refused'));
    render(
      <EphemeralPicker scope={{ kind: 'group', groupId: 'g1' }} variant="section" />,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Désactivés' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '7 jours' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Désactivés' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });
});

describe('EphemeralPicker — header variant (DM scope)', () => {
  it('opens the menu and stores the chosen TTL through the DM RPC', async () => {
    render(<EphemeralPicker scope={{ kind: 'dm', peer: 'pk1' }} variant="header" />);
    await waitFor(() => {
      expect(dmGetMock).toHaveBeenCalledWith('pk1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Messages éphémères' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '8 heures' }));

    await waitFor(() => {
      expect(dmSetMock).toHaveBeenCalledWith('pk1', 8 * 3600);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
