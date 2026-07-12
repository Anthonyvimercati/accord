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
  /** État initial des prochaines instances (simule l'autoplay WKWebView). */
  static initialState: 'running' | 'suspended' = 'running';
  state: 'running' | 'suspended' = FakeAudioContext.initialState;
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
    FakeAudioContext.initialState = 'running';
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

  it('ne consomme pas la limitation quand le contexte est suspendu (rejoue une fois déverrouillé)', async () => {
    w.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    FakeAudioContext.initialState = 'suspended';
    const { playNotificationSound } = await import('./notificationSound');

    vi.setSystemTime(50_000);
    playNotificationSound('message');

    // Contexte verrouillé : rien ne sonne, mais une reprise a été tentée.
    const context = FakeAudioContext.instances[0];
    expect(context?.createOscillator).not.toHaveBeenCalled();
    expect(context?.resume).toHaveBeenCalled();

    // Déverrouillé par un geste utilisateur : le blip suivant joue AUSSITÔT,
    // même dans la même seconde — la limitation n'a pas été consommée à vide.
    if (context !== undefined) context.state = 'running';
    playNotificationSound('message');

    expect(context?.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('ne joue rien quand le réglage « Sons de notification » est désactivé', async () => {
    w.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const { playNotificationSound } = await import('./notificationSound');
    const { useUi } = await import('../stores/ui');

    vi.setSystemTime(30_000);
    useUi.getState().setNotifySoundEnabled(false);
    playNotificationSound('message');

    expect(FakeAudioContext.instances).toHaveLength(0);

    // Réactivé, largement après la fenêtre de rafale : le blip rejoue.
    vi.setSystemTime(40_000);
    useUi.getState().setNotifySoundEnabled(true);
    playNotificationSound('message');

    expect(FakeAudioContext.instances).toHaveLength(1);
  });
});
