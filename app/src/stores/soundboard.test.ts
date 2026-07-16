/**
 * Tests du soundboard : `playSound` passe par le contexte Web Audio partagé
 * (`lib/audio.playClip`) et signale les échecs par un toast ; le gestionnaire
 * `event.soundboard_play` ne joue le clip reçu que dans le salon vocal
 * correspondant et ignore l'écho de sa propre émission ; le préchargement
 * amorce toutes les racines Merkle du groupe.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

const h = vi.hoisted(() => ({
  voiceState: { active: null as { groupId: string; channelId: string } | null },
  sessionState: { self: null as { pubkey: string } | null },
}));

vi.mock('../lib/client', () => ({
  rpc: { onEvent: vi.fn() },
  api: {},
}));

vi.mock('../lib/files', () => ({
  lireFichier: vi.fn(() => Promise.resolve('data:audio/ogg;base64,AA==')),
}));

vi.mock('../lib/audio', () => ({
  playClip: vi.fn(() => Promise.resolve(1.5)),
}));

vi.mock('./voice', () => ({ useVoice: { getState: () => h.voiceState } }));
vi.mock('./session', () => ({ useSession: { getState: () => h.sessionState } }));

import { playClip } from '../lib/audio';
import { lireFichier } from '../lib/files';
import { useGroups } from './groups';
import { handleSoundboardEvent, playSound, prefetchGroupSounds } from './soundboard';
import { useUi } from './ui';

const lireMock = lireFichier as unknown as Mock;
const playClipMock = playClip as unknown as Mock;

/** Événement typique reçu d'un pair. */
function evt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    group_id: 'g1',
    channel_id: 'g1',
    sound: 'deadbeef',
    from: 'peer',
    ...overrides,
  };
}

describe('playSound', () => {
  beforeEach(() => {
    lireMock.mockClear();
    lireMock.mockResolvedValue('data:audio/ogg;base64,AA==');
    playClipMock.mockClear();
    playClipMock.mockResolvedValue(1.5);
    useUi.setState({ toasts: [] });
  });

  it('joue le clip via le contexte audio partagé (playClip) et rend true', async () => {
    const ok = await playSound('deadbeef', 'peer');

    expect(ok).toBe(true);
    expect(lireMock).toHaveBeenCalledWith('deadbeef', 'peer');
    expect(playClipMock).toHaveBeenCalledWith('data:audio/ogg;base64,AA==');
    expect(useUi.getState().toasts).toHaveLength(0);
  });

  it('signale un fichier indisponible par un toast d’erreur (rend false)', async () => {
    lireMock.mockRejectedValueOnce(new Error('indisponible'));

    const ok = await playSound('deadbeef');

    expect(ok).toBe(false);
    const toasts = useUi.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.kind).toBe('error');
  });

  it('signale une lecture refusée (contexte verrouillé) par un toast d’erreur', async () => {
    playClipMock.mockRejectedValueOnce(new Error('contexte audio verrouillé'));

    const ok = await playSound('deadbeef');

    expect(ok).toBe(false);
    expect(useUi.getState().toasts[0]?.kind).toBe('error');
  });
});

describe('prefetchGroupSounds', () => {
  beforeEach(() => {
    lireMock.mockClear();
    lireMock.mockResolvedValue('data:audio/ogg;base64,AA==');
  });

  it('amorce la lecture de toutes les racines Merkle du groupe', () => {
    useGroups.setState({
      states: {
        g1: {
          sounds: [
            { name: 'bravo', merkle_root: 'r1' },
            { name: 'tada', merkle_root: 'r2' },
          ],
        },
      } as unknown as ReturnType<typeof useGroups.getState>['states'],
    });

    prefetchGroupSounds('g1');

    expect(lireMock).toHaveBeenCalledTimes(2);
    expect(lireMock).toHaveBeenCalledWith('r1');
    expect(lireMock).toHaveBeenCalledWith('r2');
  });

  it('reste un no-op pour un groupe inconnu ou sans sons', () => {
    useGroups.setState({
      states: {} as ReturnType<typeof useGroups.getState>['states'],
    });

    prefetchGroupSounds('inconnu');

    expect(lireMock).not.toHaveBeenCalled();
  });
});

describe('handleSoundboardEvent', () => {
  beforeEach(() => {
    lireMock.mockClear();
    lireMock.mockResolvedValue('data:audio/ogg;base64,AA==');
    playClipMock.mockClear();
    playClipMock.mockResolvedValue(1.5);
    h.voiceState.active = { groupId: 'g1', channelId: 'g1' };
    h.sessionState.self = { pubkey: 'moi' };
  });

  it('joue le clip reçu dans le salon vocal correspondant', () => {
    handleSoundboardEvent('event.soundboard_play', evt());
    expect(lireMock).toHaveBeenCalledWith('deadbeef', 'peer');
  });

  it('ignore un autre type d’événement', () => {
    handleSoundboardEvent('event.voice_speaking', evt());
    expect(lireMock).not.toHaveBeenCalled();
  });

  it('ne joue rien hors du salon vocal actif', () => {
    h.voiceState.active = { groupId: 'g2', channelId: 'g2' };
    handleSoundboardEvent('event.soundboard_play', evt());
    expect(lireMock).not.toHaveBeenCalled();
  });

  it('ne joue rien quand aucun salon vocal n’est actif', () => {
    h.voiceState.active = null;
    handleSoundboardEvent('event.soundboard_play', evt());
    expect(lireMock).not.toHaveBeenCalled();
  });

  it('ignore l’écho de sa propre émission (évite le double)', () => {
    handleSoundboardEvent('event.soundboard_play', evt({ from: 'moi' }));
    expect(lireMock).not.toHaveBeenCalled();
  });

  it('ignore un payload malformé', () => {
    handleSoundboardEvent('event.soundboard_play', { group_id: 'g1' });
    expect(lireMock).not.toHaveBeenCalled();
  });
});
