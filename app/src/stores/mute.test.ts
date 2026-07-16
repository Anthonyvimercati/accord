/**
 * Tests du store de niveaux de notification (mute) : migration de l'ancien
 * format binaire (liste d'ids « mutés » → niveau 'none'), fonctions pures
 * (serverLevel/channelLevel avec héritage salon←serveur, setters immuables),
 * helpers de compat (isServerMuted/isChannelMuted), décision de mise en
 * silence consultée par la couche notification (isConversationSilenced), et
 * tolérance à une valeur corrompue au démarrage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { channelKey } from './groups';
import {
  channelLevel,
  isChannelMuted,
  isConversationSilenced,
  isServerMuted,
  serverLevel,
  setChannelLevel,
  setServerLevel,
  useMute,
  type MuteLevels,
} from './mute';

beforeEach(() => {
  window.localStorage.clear();
  useMute.setState({ serverLevels: {}, channelLevels: {} });
});

/** Fabrique un état de niveaux pur pour tester les fonctions en isolation. */
function levels(partial: Partial<MuteLevels> = {}): MuteLevels {
  return { serverLevels: {}, channelLevels: {}, ...partial };
}

describe('serverLevel — niveau du serveur', () => {
  it('vaut « all » par défaut (aucun réglage)', () => {
    expect(serverLevel(levels(), 'g1')).toBe('all');
  });

  it('reflète le niveau explicitement réglé', () => {
    const state = levels({ serverLevels: { g1: 'mentions', g2: 'none' } });

    expect(serverLevel(state, 'g1')).toBe('mentions');
    expect(serverLevel(state, 'g2')).toBe('none');
    expect(serverLevel(state, 'g3')).toBe('all');
  });
});

describe('channelLevel — héritage salon←serveur', () => {
  it('hérite du niveau du serveur sans réglage propre', () => {
    const state = levels({ serverLevels: { g1: 'none' } });

    expect(channelLevel(state, 'g1', 'c1')).toBe('none');
  });

  it('vaut « all » quand ni le salon ni le serveur ne sont réglés', () => {
    expect(channelLevel(levels(), 'g1', 'c1')).toBe('all');
  });

  it('privilégie le réglage propre du salon sur celui du serveur', () => {
    const state = levels({
      serverLevels: { g1: 'none' },
      channelLevels: { [channelKey('g1', 'c1')]: 'all' },
    });

    // Le salon force « all » alors que le serveur est en « none ».
    expect(channelLevel(state, 'g1', 'c1')).toBe('all');
    // Un salon voisin sans réglage propre hérite bien du serveur.
    expect(channelLevel(state, 'g1', 'c2')).toBe('none');
  });

  it('distingue deux salons homonymes de serveurs différents (clé composite)', () => {
    const state = levels({ channelLevels: { [channelKey('g1', 'c1')]: 'mentions' } });

    expect(channelLevel(state, 'g1', 'c1')).toBe('mentions');
    expect(channelLevel(state, 'g2', 'c1')).toBe('all');
  });
});

describe('setServerLevel / setChannelLevel — immuabilité', () => {
  it('renvoie un nouvel état sans muter l’original (serveur)', () => {
    const before = levels();

    const after = setServerLevel(before, 'g1', 'mentions');

    expect(after.serverLevels).toEqual({ g1: 'mentions' });
    expect(before.serverLevels).toEqual({});
    expect(after.serverLevels).not.toBe(before.serverLevels);
  });

  it('renvoie un nouvel état sans muter l’original (salon)', () => {
    const before = levels();

    const after = setChannelLevel(before, 'g1', 'c1', 'none');

    expect(after.channelLevels).toEqual({ [channelKey('g1', 'c1')]: 'none' });
    expect(before.channelLevels).toEqual({});
    expect(after.channelLevels).not.toBe(before.channelLevels);
  });
});

describe('isServerMuted / isChannelMuted — helpers de compat', () => {
  it('vrai seulement au niveau « none »', () => {
    expect(isServerMuted(levels({ serverLevels: { g1: 'none' } }), 'g1')).toBe(true);
    expect(isServerMuted(levels({ serverLevels: { g1: 'mentions' } }), 'g1')).toBe(false);
    expect(isServerMuted(levels(), 'g1')).toBe(false);
  });

  it('tient compte de l’héritage pour un salon', () => {
    const inherited = levels({ serverLevels: { g1: 'none' } });
    expect(isChannelMuted(inherited, 'g1', 'c1')).toBe(true);

    const overridden = setChannelLevel(inherited, 'g1', 'c1', 'all');
    expect(isChannelMuted(overridden, 'g1', 'c1')).toBe(false);
  });
});

describe('useMute — actions persistées', () => {
  it('règle le niveau d’un serveur et le persiste en table JSON', () => {
    const before = useMute.getState().serverLevels;

    useMute.getState().setServerLevel('g1', 'mentions');

    expect(useMute.getState().serverLevels).toEqual({ g1: 'mentions' });
    expect(useMute.getState().serverLevels).not.toBe(before);
    expect(window.localStorage.getItem('accord.mute.servers')).toBe('{"g1":"mentions"}');
  });

  it('règle le niveau propre d’un salon sans affecter un homonyme', () => {
    useMute.getState().setChannelLevel('g1', 'c1', 'none');

    expect(useMute.getState().channelLevels).toEqual({
      [channelKey('g1', 'c1')]: 'none',
    });
    expect(channelLevel(useMute.getState(), 'g2', 'c1')).toBe('all');
    expect(window.localStorage.getItem('accord.mute.channels')).toBe(
      JSON.stringify({ [channelKey('g1', 'c1')]: 'none' }),
    );
  });
});

describe('isConversationSilenced — décision de mise en silence', () => {
  it('ne tait jamais les MP (hors périmètre), quel que soit le niveau', () => {
    // Un id de MP homonyme d'un serveur en « none » reste sans effet.
    useMute.getState().setServerLevel('peer-1', 'none');

    expect(isConversationSilenced({ kind: 'dm', peer: 'peer-1' }, false)).toBe(false);
    expect(isConversationSilenced({ kind: 'dm', peer: 'peer-1' }, true)).toBe(false);
  });

  it('niveau « none » : tait toujours (mention ou non)', () => {
    useMute.getState().setServerLevel('g1', 'none');
    const ref = { kind: 'group', groupId: 'g1', channelId: 'c1' } as const;

    expect(isConversationSilenced(ref, false)).toBe(true);
    expect(isConversationSilenced(ref, true)).toBe(true);
  });

  it('niveau « mentions » : tait sauf si le message me mentionne', () => {
    useMute.getState().setServerLevel('g1', 'mentions');
    const ref = { kind: 'group', groupId: 'g1', channelId: 'c1' } as const;

    expect(isConversationSilenced(ref, false)).toBe(true);
    expect(isConversationSilenced(ref, true)).toBe(false);
  });

  it('niveau « all » (défaut) : ne tait jamais', () => {
    const ref = { kind: 'group', groupId: 'g1', channelId: 'c1' } as const;

    expect(isConversationSilenced(ref, false)).toBe(false);
    expect(isConversationSilenced(ref, true)).toBe(false);
  });

  it('applique l’héritage : un salon sans réglage suit le niveau « mentions » du serveur', () => {
    useMute.getState().setServerLevel('g1', 'mentions');
    // Salon avec réglage propre « all » : notifie même sans mention.
    useMute.getState().setChannelLevel('g1', 'c2', 'all');

    expect(
      isConversationSilenced({ kind: 'group', groupId: 'g1', channelId: 'c1' }, false),
    ).toBe(true);
    expect(
      isConversationSilenced({ kind: 'group', groupId: 'g1', channelId: 'c2' }, false),
    ).toBe(false);
  });
});

describe('chargement localStorage — migration et tolérance', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('migre l’ancien format binaire (liste d’ids mutés) vers le niveau « none »', async () => {
    window.localStorage.setItem('accord.mute.servers', JSON.stringify(['g1', 'g2']));
    window.localStorage.setItem(
      'accord.mute.channels',
      JSON.stringify([channelKey('g1', 'c1')]),
    );

    const { useMute: fresh } = await import('./mute');

    expect(fresh.getState().serverLevels).toEqual({ g1: 'none', g2: 'none' });
    expect(fresh.getState().channelLevels).toEqual({ [channelKey('g1', 'c1')]: 'none' });
  });

  it('restaure une table de niveaux valide', async () => {
    window.localStorage.setItem(
      'accord.mute.servers',
      JSON.stringify({ g1: 'mentions', g2: 'none' }),
    );
    window.localStorage.setItem(
      'accord.mute.channels',
      JSON.stringify({ [channelKey('g1', 'c1')]: 'all' }),
    );

    const { useMute: fresh } = await import('./mute');

    expect(fresh.getState().serverLevels).toEqual({ g1: 'mentions', g2: 'none' });
    expect(fresh.getState().channelLevels).toEqual({ [channelKey('g1', 'c1')]: 'all' });
  });

  it('replie sur une table vide si la valeur stockée est corrompue', async () => {
    window.localStorage.setItem('accord.mute.servers', 'not-json');
    window.localStorage.setItem('accord.mute.channels', '42');

    const { useMute: fresh } = await import('./mute');

    expect(fresh.getState().serverLevels).toEqual({});
    expect(fresh.getState().channelLevels).toEqual({});
  });

  it('ignore les niveaux invalides d’une table par ailleurs valide', async () => {
    window.localStorage.setItem(
      'accord.mute.servers',
      JSON.stringify({ g1: 'none', g2: 'bogus', g3: 42 }),
    );

    const { useMute: fresh } = await import('./mute');

    expect(fresh.getState().serverLevels).toEqual({ g1: 'none' });
  });
});
