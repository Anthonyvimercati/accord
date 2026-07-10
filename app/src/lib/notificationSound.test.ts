/**
 * Tests du blip de notification : silencieux (jamais d'exception) sans
 * support Web Audio, et limité à une lecture par seconde même en rafale.
 * Chaque test importe le module à neuf (`vi.resetModules`) pour isoler le
 * contexte audio partagé (singleton module) d'un test à l'autre.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeGain {
  gain = {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
}

class FakeOscillator {
  type = 'sine';
  frequency = { value: 0 };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: 'running' | 'suspended' = 'running';
  currentTime = 0;
  destination = {};
  createGain = vi.fn(() => new FakeGain());
  createOscillator = vi.fn(() => new FakeOscillator());
  resume = vi.fn().mockResolvedValue(undefined);

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

interface WindowWithAudio {
  AudioContext?: typeof AudioContext | undefined;
  webkitAudioContext?: typeof AudioContext | undefined;
}

describe('playNotificationSound', () => {
  const w = window as unknown as WindowWithAudio;
  let originalAudioContext: typeof AudioContext | undefined;

  beforeEach(() => {
    originalAudioContext = w.AudioContext;
    FakeAudioContext.instances = [];
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    w.AudioContext = originalAudioContext;
    vi.useRealTimers();
  });

  it('ne lève jamais sans support Web Audio (API absente)', async () => {
    delete w.AudioContext;
    delete w.webkitAudioContext;
    const { playNotificationSound } = await import('./notificationSound');

    expect(() => playNotificationSound('message')).not.toThrow();
  });

  it('crée le contexte et joue deux notes (deux oscillateurs) par appel', async () => {
    w.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const { playNotificationSound } = await import('./notificationSound');

    vi.setSystemTime(10_000);
    playNotificationSound('mention');

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0]?.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('limite la lecture à une fois par seconde même en rafale', async () => {
    w.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const { playNotificationSound } = await import('./notificationSound');

    vi.setSystemTime(20_000);
    playNotificationSound('message');
    playNotificationSound('message');
    playNotificationSound('message');

    // Une rafale immédiate ne crée qu'un contexte et ne joue qu'une fois.
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0]?.createOscillator).toHaveBeenCalledTimes(2);

    // Passé le délai de rafale (>= 1 s), un nouvel appel rejoue.
    vi.setSystemTime(21_100);
    playNotificationSound('message');

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0]?.createOscillator).toHaveBeenCalledTimes(4);
  });
});
