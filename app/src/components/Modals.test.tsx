/**
 * Tests de la modale d'invitation de serveur (consentement explicite, D-045) :
 * seuls les amis non-membres sont proposés, et le clic appelle bien
 * `groups.invite_create` — jamais l'ancien force-join (`groups.invite`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../lib/client', () => ({
  rpc: { onEvent: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) },
  api: {
    groupsInviteCreate: vi.fn(() => Promise.resolve({ invite_id: 'i1' })),
    groupsState: vi.fn(() => Promise.resolve(groupStateFixture())),
  },
}));

import { api } from '../lib/client';
import type { Contact, GroupStateJson } from '../lib/api';
import { useFriends } from '../stores/friends';
import { useGroups } from '../stores/groups';
import { useUi } from '../stores/ui';
import { Modals } from './Modals';

function groupStateFixture(members: GroupStateJson['members'] = []): GroupStateJson {
  return {
    group_id: 'g1',
    name: 'Guilde',
    icon: null,
    founder: null,
    members,
    bans: [],
    channels: [],
    categories: [],
    roles: [],
    invites: [],
    my_permissions: 0,
  };
}

describe('InviteModal (Modals.tsx) — invitation par consentement (D-045)', () => {
  beforeEach(() => {
    useUi.setState({ lang: 'fr', modal: { kind: 'invite', groupId: 'g1' } });
    useFriends.setState({
      contacts: [
        { pubkey: 'pk_bob', display_name: 'Bob', state: 'friend' },
        { pubkey: 'pk_membre', display_name: 'Déjà membre', state: 'friend' },
      ] as unknown as Contact[],
    });
    useGroups.setState({
      states: { g1: groupStateFixture([{ pubkey: 'pk_membre', roles: [] }]) },
    });
    (api.groupsInviteCreate as unknown as ReturnType<typeof vi.fn>).mockClear();
    (api.groupsState as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('propose seulement les amis qui ne sont pas déjà membres', () => {
    render(<Modals />);

    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Déjà membre')).not.toBeInTheDocument();
  });

  it('appelle groups.invite_create au clic — jamais l’ancien force-join', async () => {
    render(<Modals />);

    fireEvent.click(screen.getByRole('button', { name: 'Inviter' }));

    await vi.waitFor(() =>
      expect(api.groupsInviteCreate).toHaveBeenCalledWith('g1', 'pk_bob'),
    );
  });
});
