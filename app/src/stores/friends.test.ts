/**
 * Tests de la logique du store contacts : nom affichable et hash d'avatar
 * d'un pair, application d'un profil annoncé (`event.profile`) et marquage
 * lu d'une conversation (`dm.mark_read` puis rechargement de la liste).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../lib/client', () => ({
  api: { dmMarkRead: vi.fn(), friendsList: vi.fn() },
}));

import { api } from '../lib/client';
import type { Contact } from '../lib/api';
import { avatarOf, displayNameOf, useFriends } from './friends';

const dmMarkReadMock = api.dmMarkRead as unknown as Mock;
const friendsListMock = api.friendsList as unknown as Mock;

beforeEach(() => {
  dmMarkReadMock.mockReset();
  friendsListMock.mockReset();
});

function contact(pubkey: string, displayName: string): Contact {
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
  };
}

describe('displayNameOf', () => {
  it('rend le nom affiché du contact connu', () => {
    const contacts = [contact('aabbccddee', 'Alice')];
    expect(displayNameOf(contacts, 'aabbccddee')).toBe('Alice');
  });

  it('replie sur l’identifiant court pour un pair inconnu', () => {
    expect(displayNameOf([], 'aabbccddee')).toBe('aabbcc');
  });

  it('replie sur l’identifiant court si le nom affiché est vide', () => {
    const contacts = [contact('aabbccddee', '   ')];
    expect(displayNameOf(contacts, 'aabbccddee')).toBe('aabbcc');
  });
});

describe('avatarOf', () => {
  it('rend le hash d’avatar du contact connu', () => {
    const alice = { ...contact('aabbccddee', 'Alice'), avatar: 'cafe'.repeat(16) };
    expect(avatarOf([alice], 'aabbccddee')).toBe('cafe'.repeat(16));
  });

  it('rend null pour un pair inconnu ou sans avatar', () => {
    expect(avatarOf([], 'aabbccddee')).toBeNull();
    expect(avatarOf([contact('aabbccddee', 'Alice')], 'aabbccddee')).toBeNull();
  });
});

describe('useFriends.applyProfile', () => {
  it('met à jour pseudo, bio et avatar du contact visé (event.profile)', () => {
    useFriends.setState({
      contacts: [contact('alice-pk', 'Alice'), contact('bob-pk', 'Bob')],
    });

    useFriends.getState().applyProfile({
      pubkey: 'alice-pk',
      name: 'Alicia',
      bio: 'salut !',
      avatar: 'ab'.repeat(32),
      banner: null,
    });

    const [alice, bob] = useFriends.getState().contacts;
    expect(alice).toMatchObject({
      display_name: 'Alicia',
      bio: 'salut !',
      avatar: 'ab'.repeat(32),
      banner: null,
    });
    expect(bob).toMatchObject({ display_name: 'Bob', bio: null, avatar: null });
  });

  it('efface bio et avatar quand l’annonce les rend nuls', () => {
    useFriends.setState({
      contacts: [
        { ...contact('alice-pk', 'Alice'), bio: 'ancienne', avatar: 'cd'.repeat(32) },
      ],
    });

    useFriends.getState().applyProfile({
      pubkey: 'alice-pk',
      name: 'Alice',
      bio: null,
      avatar: null,
      banner: null,
    });

    expect(useFriends.getState().contacts[0]).toMatchObject({
      bio: null,
      avatar: null,
      banner: null,
    });
  });

  it('ignore un profil de pair inconnu (le nœud n’annonce que des amis)', () => {
    const contacts = [contact('alice-pk', 'Alice')];
    useFriends.setState({ contacts });

    useFriends.getState().applyProfile({
      pubkey: 'inconnu-pk',
      name: 'Intrus',
      bio: null,
      avatar: null,
      banner: null,
    });

    expect(useFriends.getState().contacts).toEqual(contacts);
  });
});

describe('useFriends.markRead', () => {
  it('enregistre la position de lecture puis recharge la liste', async () => {
    // Arrange : après relecture, le nœud rend le contact sans non-lu.
    const alice = { ...contact('alice-pk', 'Alice'), unread: 0 };
    dmMarkReadMock.mockResolvedValueOnce({ ok: true });
    friendsListMock.mockResolvedValueOnce({ contacts: [alice] });

    // Act
    await useFriends.getState().markRead('alice-pk', 7);

    // Assert
    expect(dmMarkReadMock).toHaveBeenCalledWith('alice-pk', 7);
    expect(useFriends.getState().contacts).toEqual([alice]);
  });

  it('ne recharge pas la liste quand le nœud refuse le marquage', async () => {
    // Arrange
    dmMarkReadMock.mockRejectedValueOnce(new Error('pair inconnu'));

    // Act / Assert
    await expect(useFriends.getState().markRead('alice-pk', 7)).rejects.toThrow();
    expect(friendsListMock).not.toHaveBeenCalled();
  });
});
