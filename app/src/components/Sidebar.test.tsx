/**
 * Tests de la barre latérale : pastilles de non-lus sur les conversations
 * privées (champ `unread` de friends.list) et sur les salons d'un serveur
 * (compteurs de groups.list), absentes sans non-lu.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Contact, GroupStateJson } from '../lib/api';
import { useFriends } from '../stores/friends';
import { useGroups } from '../stores/groups';
import { useSession } from '../stores/session';
import { useUi } from '../stores/ui';
import { Sidebar } from './Sidebar';

function contact(pubkey: string, displayName: string, unread?: number): Contact {
  return {
    node_id: 'noeud',
    pubkey,
    friend_code: 'accord-lion-foret-12345',
    display_name: displayName,
    bio: null,
    avatar: null,
    banner: null,
    state: 'friend',
    last_seen_ms: 0,
    ...(unread !== undefined ? { unread } : {}),
  };
}

function groupState(): GroupStateJson {
  return {
    group_id: 'g1',
    name: 'Guilde',
    icon: null,
    founder: null,
    members: [],
    bans: [],
    channels: [
      {
        channel_id: 'c1',
        name: 'général',
        kind: 'text',
        category: null,
        position: 0,
        topic: '',
      },
      {
        channel_id: 'c2',
        name: 'projets',
        kind: 'text',
        category: null,
        position: 1,
        topic: '',
      },
    ],
    categories: [],
    roles: [],
    invites: [],
    my_permissions: 0,
  };
}

beforeEach(() => {
  useUi.setState({ lang: 'fr', view: { kind: 'friends' } });
  useSession.setState({ self: null });
  useFriends.setState({ contacts: [] });
  useGroups.setState({ ids: [], states: {}, unread: {} });
});

describe('Sidebar — non-lus des conversations privées', () => {
  it('affiche la pastille avec le compte du contact', () => {
    // Arrange
    useFriends.setState({
      contacts: [contact('alice-pk', 'Alice', 3), contact('bob-pk', 'Bob')],
    });

    // Act
    render(<Sidebar />);

    // Assert
    const badge = screen.getByLabelText('3 message(s) non lu(s)');
    expect(badge).toHaveTextContent('3');
  });

  it("n'affiche aucune pastille sans non-lu", () => {
    // Arrange
    useFriends.setState({
      contacts: [contact('alice-pk', 'Alice', 0), contact('bob-pk', 'Bob')],
    });

    // Act
    render(<Sidebar />);

    // Assert
    expect(screen.queryByLabelText(/non lu/)).not.toBeInTheDocument();
  });
});

describe('Sidebar — non-lus des salons', () => {
  it('affiche la pastille sur le seul salon ayant des non-lus', () => {
    // Arrange
    useUi.setState({ view: { kind: 'group', groupId: 'g1', channelId: 'c1' } });
    useGroups.setState({
      ids: ['g1'],
      states: { g1: groupState() },
      unread: { g1: { c2: 5 } },
    });

    // Act
    render(<Sidebar />);

    // Assert
    const badge = screen.getByLabelText('5 message(s) non lu(s)');
    expect(badge).toHaveTextContent('5');
    expect(screen.getAllByLabelText(/non lu/)).toHaveLength(1);
  });
});
