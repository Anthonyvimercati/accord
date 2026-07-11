/**
 * Tests du store de sourdine (mute) : helpers purs (isServerMuted/
 * isChannelMuted), bascules immuables persistées en localStorage,
 * combinaison serveur/salon consultée par la couche notification
 * (isConversationMuted), et tolérance à une valeur corrompue au démarrage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { channelKey } from './groups';
import { isChannelMuted, isConversationMuted, isServerMuted, useMute } from './mute';

beforeEach(() => {
  window.localStorage.clear();
  useMute.setState({ mutedServers: [], mutedChannels: [] });
});

describe('isServerMuted / isChannelMuted — helpers purs', () => {
  it('détecte un serveur en sourdine dans la liste', () => {
    expect(isServerMuted(['g1', 'g2'], 'g1')).toBe(true);
    expect(isServerMuted(['g2'], 'g1')).toBe(false);
  });

  it('détecte un salon en sourdine via sa clé composite groupId/channelId', () => {
    const muted = [channelKey('g1', 'c1')];

    expect(isChannelMuted(muted, 'g1', 'c1')).toBe(true);
    expect(isChannelMuted(muted, 'g1', 'c2')).toBe(false);
    // Même channel_id dans un autre serveur : pas confondu (clé composite).
    expect(isChannelMuted(muted, 'g2', 'c1')).toBe(false);
  });
});

describe('useMute — toggleServerMute', () => {
  it('met un serveur en sourdine puis la retire, immuablement, en persistant', () => {
    const before = useMute.getState().mutedServers;

    useMute.getState().toggleServerMute('g1');

    expect(useMute.getState().mutedServers).toEqual(['g1']);
    expect(useMute.getState().mutedServers).not.toBe(before);
    expect(window.localStorage.getItem('accord.mute.servers')).toBe('["g1"]');

    useMute.getState().toggleServerMute('g1');

    expect(useMute.getState().mutedServers).toEqual([]);
    expect(window.localStorage.getItem('accord.mute.servers')).toBe('[]');
  });

  it('gère plusieurs serveurs en sourdine indépendamment', () => {
    useMute.getState().toggleServerMute('g1');
    useMute.getState().toggleServerMute('g2');

    expect([...useMute.getState().mutedServers].sort()).toEqual(['g1', 'g2']);

    useMute.getState().toggleServerMute('g1');

    expect(useMute.getState().mutedServers).toEqual(['g2']);
  });
});

describe('useMute — toggleChannelMute', () => {
  it('met un salon en sourdine sans affecter un salon homonyme d’un autre serveur', () => {
    useMute.getState().toggleChannelMute('g1', 'c1');

    expect(useMute.getState().mutedChannels).toEqual([channelKey('g1', 'c1')]);
    expect(isChannelMuted(useMute.getState().mutedChannels, 'g2', 'c1')).toBe(false);
    expect(window.localStorage.getItem('accord.mute.channels')).toBe(
      JSON.stringify([channelKey('g1', 'c1')]),
    );
  });

  it('réactive un salon déjà en sourdine (bascule)', () => {
    useMute.getState().toggleChannelMute('g1', 'c1');
    useMute.getState().toggleChannelMute('g1', 'c1');

    expect(useMute.getState().mutedChannels).toEqual([]);
  });
});

describe('isConversationMuted', () => {
  it('ne coupe jamais les MP (hors périmètre de cette version)', () => {
    // Un id de MP homonyme d'un serveur en sourdine reste sans effet.
    useMute.getState().toggleServerMute('peer-1');

    expect(isConversationMuted({ kind: 'dm', peer: 'peer-1' })).toBe(false);
  });

  it('coupe un message de groupe quand le serveur entier est en sourdine', () => {
    useMute.getState().toggleServerMute('g1');

    expect(isConversationMuted({ kind: 'group', groupId: 'g1', channelId: 'c1' })).toBe(
      true,
    );
  });

  it('coupe un message de groupe quand seul le salon visé est en sourdine', () => {
    useMute.getState().toggleChannelMute('g1', 'c1');

    expect(isConversationMuted({ kind: 'group', groupId: 'g1', channelId: 'c1' })).toBe(
      true,
    );
    expect(isConversationMuted({ kind: 'group', groupId: 'g1', channelId: 'c2' })).toBe(
      false,
    );
  });

  it('ne coupe rien sans sourdine active', () => {
    expect(isConversationMuted({ kind: 'group', groupId: 'g1', channelId: 'c1' })).toBe(
      false,
    );
  });
});

describe('lecture localStorage tolérante au démarrage', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('replie sur une liste vide si la valeur stockée est corrompue', async () => {
    window.localStorage.setItem('accord.mute.servers', 'not-json');
    window.localStorage.setItem('accord.mute.channels', '{"not":"an array"}');

    const { useMute: freshUseMute } = await import('./mute');

    expect(freshUseMute.getState().mutedServers).toEqual([]);
    expect(freshUseMute.getState().mutedChannels).toEqual([]);
  });

  it('restaure une liste valide persistée', async () => {
    window.localStorage.setItem('accord.mute.servers', JSON.stringify(['g1']));
    window.localStorage.setItem(
      'accord.mute.channels',
      JSON.stringify([channelKey('g1', 'c1')]),
    );

    const { useMute: freshUseMute } = await import('./mute');

    expect(freshUseMute.getState().mutedServers).toEqual(['g1']);
    expect(freshUseMute.getState().mutedChannels).toEqual([channelKey('g1', 'c1')]);
  });
});
