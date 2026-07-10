/**
 * Tests du store vocal : rejoindre/quitter, bascule micro, application des
 * événements `event.voice_*` et resynchronisation via `voice.status`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../lib/client', () => ({
  api: {
    voiceJoin: vi.fn(),
    voiceLeave: vi.fn(),
    voiceMute: vi.fn(),
    voiceStatus: vi.fn(),
  },
}));

import { api } from '../lib/client';
import { useVoice } from './voice';

const joinMock = api.voiceJoin as unknown as Mock;
const leaveMock = api.voiceLeave as unknown as Mock;
const muteMock = api.voiceMute as unknown as Mock;
const statusMock = api.voiceStatus as unknown as Mock;

/** Pose un salon actif avec des participants, sans passer par l'API. */
function seedActive(
  groupId = 'g1',
  participants: Array<[string, boolean]> = [
    ['moi', false],
    ['alice', false],
  ],
): void {
  useVoice.setState({
    active: { groupId, channelId: groupId, muted: false },
    participants: new Map(participants.map(([pk, speaking]) => [pk, { speaking }])),
  });
}

function participantKeys(): string[] {
  return [...useVoice.getState().participants.keys()];
}

beforeEach(() => {
  useVoice.setState({ active: null, participants: new Map() });
  joinMock.mockReset();
  leaveMock.mockReset();
  muteMock.mockReset();
  statusMock.mockReset();
});

describe('useVoice.join', () => {
  it('rejoint le salon et enregistre les participants (personne ne parle)', async () => {
    joinMock.mockResolvedValueOnce({ participants: ['moi', 'alice'] });

    await useVoice.getState().join('g1', 'g1');

    expect(joinMock).toHaveBeenCalledWith('g1', 'g1');
    expect(useVoice.getState().active).toEqual({
      groupId: 'g1',
      channelId: 'g1',
      muted: false,
    });
    expect(participantKeys()).toEqual(['moi', 'alice']);
    expect(useVoice.getState().participants.get('alice')).toEqual({ speaking: false });
  });

  it('remplace le salon précédent (join implique leave côté nœud)', async () => {
    seedActive('g0');
    joinMock.mockResolvedValueOnce({ participants: ['moi'] });

    await useVoice.getState().join('g1', 'g1');

    expect(useVoice.getState().active?.groupId).toBe('g1');
    expect(participantKeys()).toEqual(['moi']);
  });

  it('ne change rien localement quand le nœud refuse (salon plein)', async () => {
    joinMock.mockRejectedValueOnce(new Error('salon plein'));

    await expect(useVoice.getState().join('g1', 'g1')).rejects.toThrow();

    expect(useVoice.getState().active).toBeNull();
    expect(participantKeys()).toEqual([]);
  });
});

describe('useVoice.leave', () => {
  it('quitte le salon et vide les participants', async () => {
    seedActive();
    leaveMock.mockResolvedValueOnce({});

    await useVoice.getState().leave();

    expect(leaveMock).toHaveBeenCalledTimes(1);
    expect(useVoice.getState().active).toBeNull();
    expect(participantKeys()).toEqual([]);
  });
});

describe('useVoice.toggleMute', () => {
  it('coupe puis rétablit le micro en restant dans le salon', async () => {
    seedActive();
    muteMock.mockResolvedValue({});

    await useVoice.getState().toggleMute();
    expect(muteMock).toHaveBeenLastCalledWith(true);
    expect(useVoice.getState().active?.muted).toBe(true);

    await useVoice.getState().toggleMute();
    expect(muteMock).toHaveBeenLastCalledWith(false);
    expect(useVoice.getState().active?.muted).toBe(false);
    expect(useVoice.getState().active?.groupId).toBe('g1');
  });

  it('ne fait rien hors salon vocal', async () => {
    await useVoice.getState().toggleMute();

    expect(muteMock).not.toHaveBeenCalled();
  });

  it('ne bascule pas localement quand le nœud refuse', async () => {
    seedActive();
    muteMock.mockRejectedValueOnce(new Error('hors ligne'));

    await expect(useVoice.getState().toggleMute()).rejects.toThrow();

    expect(useVoice.getState().active?.muted).toBe(false);
  });
});

describe('événements voice_*', () => {
  it('voice_joined ajoute un participant au salon actif', () => {
    seedActive();

    useVoice.getState().applyJoined({ group_id: 'g1', channel_id: 'g1', pubkey: 'bob' });

    expect(participantKeys()).toEqual(['moi', 'alice', 'bob']);
    expect(useVoice.getState().participants.get('bob')).toEqual({ speaking: false });
  });

  it('voice_joined ignore un autre salon et reste idempotent', () => {
    seedActive('g1', [['alice', true]]);

    useVoice.getState().applyJoined({ group_id: 'g2', channel_id: 'g2', pubkey: 'bob' });
    useVoice
      .getState()
      .applyJoined({ group_id: 'g1', channel_id: 'g1', pubkey: 'alice' });

    expect(participantKeys()).toEqual(['alice']);
    // Le doublon ne réinitialise pas l'état de parole existant.
    expect(useVoice.getState().participants.get('alice')).toEqual({ speaking: true });
  });

  it('voice_joined est ignoré hors salon vocal', () => {
    useVoice.getState().applyJoined({ group_id: 'g1', channel_id: 'g1', pubkey: 'bob' });

    expect(participantKeys()).toEqual([]);
  });

  it('voice_left retire le participant du salon actif', () => {
    seedActive();

    useVoice.getState().applyLeft({ group_id: 'g1', channel_id: 'g1', pubkey: 'alice' });

    expect(participantKeys()).toEqual(['moi']);
  });

  it('voice_left ignore un autre salon et un inconnu', () => {
    seedActive();

    useVoice.getState().applyLeft({ group_id: 'g2', channel_id: 'g2', pubkey: 'moi' });
    useVoice
      .getState()
      .applyLeft({ group_id: 'g1', channel_id: 'g1', pubkey: 'fantôme' });

    expect(participantKeys()).toEqual(['moi', 'alice']);
  });

  it('voice_speaking met à jour l’état de parole d’un participant connu', () => {
    seedActive();

    useVoice.getState().applySpeaking({ pubkey: 'alice', speaking: true });
    expect(useVoice.getState().participants.get('alice')).toEqual({ speaking: true });

    useVoice.getState().applySpeaking({ pubkey: 'alice', speaking: false });
    expect(useVoice.getState().participants.get('alice')).toEqual({ speaking: false });
  });

  it('voice_speaking ignore un participant inconnu', () => {
    seedActive('g1', [['moi', false]]);

    useVoice.getState().applySpeaking({ pubkey: 'fantôme', speaking: true });

    expect(participantKeys()).toEqual(['moi']);
  });
});

describe('useVoice.sync', () => {
  it('restaure le salon actif et les participants depuis voice.status', async () => {
    statusMock.mockResolvedValueOnce({
      active: {
        group_id: 'g1',
        channel_id: 'g1',
        muted: true,
        participants: [
          { pubkey: 'moi', speaking: false },
          { pubkey: 'alice', speaking: true },
        ],
      },
    });

    await useVoice.getState().sync();

    expect(useVoice.getState().active).toEqual({
      groupId: 'g1',
      channelId: 'g1',
      muted: true,
    });
    expect(useVoice.getState().participants.get('alice')).toEqual({ speaking: true });
    expect(useVoice.getState().participants.get('moi')).toEqual({ speaking: false });
  });

  it('vide l’état local quand aucun salon n’est actif côté nœud', async () => {
    seedActive();
    statusMock.mockResolvedValueOnce({ active: null });

    await useVoice.getState().sync();

    expect(useVoice.getState().active).toBeNull();
    expect(participantKeys()).toEqual([]);
  });
});
