/**
 * Tests de la logique d'appui-pour-parler (contrôleur pur) : micro coupé à
 * l'engagement, rétabli pendant l'appui, re-coupé au relâchement, répétitions
 * automatiques et autres touches ignorées, échecs signalés. Et du libellé
 * lisible des codes de touche.
 */

import { describe, expect, it, vi } from 'vitest';
import { createPttController, formatKeyLabel, type PttEffects } from './usePushToTalk';

/** Effets espionnés : consigne chaque bascule micro demandée. */
function makeEffects(): { effects: PttEffects; muteCalls: boolean[] } {
  const muteCalls: boolean[] = [];
  return {
    muteCalls,
    effects: {
      setMuted: vi.fn(async (muted: boolean) => {
        muteCalls.push(muted);
      }),
      onError: vi.fn(),
    },
  };
}

describe('createPttController', () => {
  it('coupe le micro à l’engagement (on démarre muet)', () => {
    const { effects, muteCalls } = makeEffects();
    const ptt = createPttController('Space', effects);

    ptt.engage();

    expect(muteCalls).toEqual([true]);
  });

  it('rétablit le micro à l’appui et le re-coupe au relâchement', () => {
    const { effects, muteCalls } = makeEffects();
    const ptt = createPttController('Space', effects);
    ptt.engage();

    ptt.keyDown({ code: 'Space', repeat: false });
    ptt.keyUp({ code: 'Space' });

    expect(muteCalls).toEqual([true, false, true]);
  });

  it('ignore les répétitions automatiques pendant l’appui maintenu', () => {
    const { effects, muteCalls } = makeEffects();
    const ptt = createPttController('Space', effects);
    ptt.engage();

    ptt.keyDown({ code: 'Space', repeat: false });
    ptt.keyDown({ code: 'Space', repeat: true });
    ptt.keyDown({ code: 'Space', repeat: true });

    expect(muteCalls).toEqual([true, false]);
  });

  it('ignore les autres touches, à l’appui comme au relâchement', () => {
    const { effects, muteCalls } = makeEffects();
    const ptt = createPttController('KeyV', effects);
    ptt.engage();

    ptt.keyDown({ code: 'Space', repeat: false });
    ptt.keyUp({ code: 'Space' });

    expect(muteCalls).toEqual([true]);
  });

  it('ignore un relâchement sans appui préalable', () => {
    const { effects, muteCalls } = makeEffects();
    const ptt = createPttController('Space', effects);

    ptt.keyUp({ code: 'Space' });

    expect(muteCalls).toEqual([]);
  });

  it('signale les échecs de bascule via onError sans casser la suite', async () => {
    const onError = vi.fn();
    const ptt = createPttController('Space', {
      setMuted: vi.fn(() => Promise.reject(new Error('hors ligne'))),
      onError,
    });

    ptt.engage();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('formatKeyLabel', () => {
  it('abrège les codes de lettres et de chiffres', () => {
    expect(formatKeyLabel('KeyV')).toBe('V');
    expect(formatKeyLabel('Digit5')).toBe('5');
  });

  it('laisse les autres codes tels quels', () => {
    expect(formatKeyLabel('Space')).toBe('Space');
    expect(formatKeyLabel('ShiftLeft')).toBe('ShiftLeft');
  });
});
