/**
 * Tests du panneau d'invitations reçues (consentement explicite, D-045) :
 * état vide, affichage serveur/inviteur, et bascule Accepter/Refuser vers
 * les actions du store des groupes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../lib/client', () => ({
  rpc: { onEvent: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) },
  api: {},
}));

import type { Contact, PendingInvite } from '../lib/api';
import { useFriends } from '../stores/friends';
import { useGroups } from '../stores/groups';
import { useUi } from '../stores/ui';
import { PendingInvites } from './PendingInvites';

const acceptInvite = vi.fn(() => Promise.resolve());
const declineInvite = vi.fn(() => Promise.resolve());

function invite(): PendingInvite {
  return {
    group_id: 'g1',
    invite_id: 'i1',
    group_name: 'Guilde',
    inviter: 'pk_bob',
    expires_ms: 9999,
  };
}

beforeEach(() => {
  useUi.setState({ lang: 'fr' });
  useFriends.setState({
    contacts: [{ pubkey: 'pk_bob', display_name: 'Bob', state: 'friend' }] as unknown as Contact[],
  });
  useGroups.setState({
    pendingInvites: [invite()],
    acceptInvite: acceptInvite as unknown as ReturnType<typeof useGroups.getState>['acceptInvite'],
    declineInvite: declineInvite as unknown as ReturnType<
      typeof useGroups.getState
    >['declineInvite'],
  });
  acceptInvite.mockClear();
  declineInvite.mockClear();
});

describe('PendingInvites', () => {
  it('affiche le serveur et l’inviteur, puis accepte au clic', () => {
    render(<PendingInvites />);

    expect(screen.getByText('Guilde')).toBeInTheDocument();
    expect(screen.getByText('Invité·e par Bob')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Accepter' }));

    expect(acceptInvite).toHaveBeenCalledWith('g1', 'i1');
  });

  it('refuse au clic sur Refuser', () => {
    render(<PendingInvites />);

    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));

    expect(declineInvite).toHaveBeenCalledWith('g1', 'i1');
  });

  it('affiche l’état vide sans invitation', () => {
    useGroups.setState({ pendingInvites: [] });
    render(<PendingInvites />);

    expect(screen.getByText('Aucune invitation en attente.')).toBeInTheDocument();
  });
});
