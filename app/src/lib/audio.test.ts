/**
 * Tests du contexte Web Audio partagé : création paresseuse, machine à états
 * de reprise (`suspended` ET l'état non standard WebKit `interrupted`),
 * déverrouillage global au geste utilisateur, notes synthétisées programmées
 * seulement quand le contexte tourne, et lecture de clips décodés. Chaque
 * test importe le module à neuf (`vi.resetModules`) pour isoler le contexte
 * partagé (singleton module) d'un test à l'autre.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeState = 'running' | 'suspended' | 'interrupted' | 'closed';

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

class FakeBufferSource {
  buffer: unknown = null;
  connect = vi.fn();
  start = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  /** État initial des prochaines instances (simule l'autoplay WKWebView). */
  static initialState: FakeState = 'running';
  /** Si faux, `resume()` n'a aucun effet (contexte resté verrouillé). */
  static resumeUnlocks = true;

  state: FakeState = FakeAudioContext.initialState;
  currentTime = 0;
  destination = {};
  createGain = vi.fn(() => new FakeGain());
  createOscillator = vi.fn(() => new FakeOscillator());
  createBufferSource = vi.fn(() => new FakeBufferSource());
  decodeAudioData = vi.fn(() => Promise.resolve({ duration: 1.5 }));
  resume = vi.fn(() => {
    if (FakeAudioContext.resumeUnlocks) this.state = 'running';
    return Promise.resolve();
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

interface WindowWithAudio {
  AudioContext?: typeof AudioContext | undefined;
  webkitAudioContext?: typeof AudioContext | undefined;
}

const w = window as unknown as WindowWithAudio;

async function importAudio() {
  return import('./audio');
}

describe('audio partagé (lib/audio)', () => {
  let originalAudioContext: typeof AudioContext | undefined;

  beforeEach(() => {
    originalAudioContext = w.AudioContext;
    FakeAudioContext.instances = [];
    FakeAudioContext.initialState = 'running';
    FakeAudioContext.resumeUnlocks = true;
    w.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    vi.resetModules();
  });

  afterEach(() => {
    w.AudioContext = originalAudioContext;
  });

  describe('getAudioContext / ensureRunning', () => {
    it('rend null sans API Web Audio et ne lève jamais', async () => {
      delete w.AudioContext;
      delete w.webkitAudioContext;
      const { getAudioContext, ensureRunning } = await importAudio();

      expect(getAudioContext()).toBeNull();
      expect(ensureRunning()).toBeNull();
    });

    it('crée un seul contexte partagé (singleton paresseux)', async () => {
      const { getAudioContext } = await importAudio();

      const a = getAudioContext();
      const b = getAudioContext();

      expect(a).toBe(b);
      expect(FakeAudioContext.instances).toHaveLength(1);
    });

    it("reprend un contexte 'suspended'", async () => {
      FakeAudioContext.initialState = 'suspended';
      const { ensureRunning } = await importAudio();

      ensureRunning();

      expect(FakeAudioContext.instances[0]?.resume).toHaveBeenCalledTimes(1);
    });

    it("reprend l'état non standard WebKit 'interrupted'", async () => {
      FakeAudioContext.initialState = 'interrupted';
      const { ensureRunning } = await importAudio();

      ensureRunning();

      expect(FakeAudioContext.instances[0]?.resume).toHaveBeenCalledTimes(1);
    });

    it('ne reprend pas un contexte déjà en route', async () => {
      const { ensureRunning } = await importAudio();

      ensureRunning();

      expect(FakeAudioContext.instances[0]?.resume).not.toHaveBeenCalled();
    });
  });

  describe('armAudioUnlock', () => {
    it('un geste utilisateur crée et reprend le contexte', async () => {
      FakeAudioContext.initialState = 'suspended';
      const { armAudioUnlock } = await importAudio();

      armAudioUnlock();
      expect(FakeAudioContext.instances).toHaveLength(0);

      window.dispatchEvent(new Event('pointerdown'));

      expect(FakeAudioContext.instances).toHaveLength(1);
      expect(FakeAudioContext.instances[0]?.resume).toHaveBeenCalledTimes(1);
      expect(FakeAudioContext.instances[0]?.state).toBe('running');
    });

    it('le clavier déverrouille aussi, et une re-suspension est ranimée au geste suivant', async () => {
      FakeAudioContext.initialState = 'suspended';
      const { armAudioUnlock } = await importAudio();

      armAudioUnlock();
      window.dispatchEvent(new Event('keydown'));
      const context = FakeAudioContext.instances[0];
      expect(context?.state).toBe('running');

      // La WKWebView re-suspend en cours de session : le geste suivant ranime.
      if (context !== undefined) context.state = 'interrupted';
      window.dispatchEvent(new Event('pointerdown'));

      expect(context?.state).toBe('running');
    });

    it('est idempotent : un double armement ne double pas les reprises', async () => {
      FakeAudioContext.initialState = 'suspended';
      FakeAudioContext.resumeUnlocks = false;
      const { armAudioUnlock } = await importAudio();

      armAudioUnlock();
      armAudioUnlock();
      window.dispatchEvent(new Event('pointerdown'));

      expect(FakeAudioContext.instances[0]?.resume).toHaveBeenCalledTimes(1);
    });
  });

  describe('playTones', () => {
    it('programme les notes (un oscillateur chacune) et rend true quand le contexte tourne', async () => {
      const { playTones } = await importAudio();

      const played = playTones([
        { freq: 660, at: 0, duration: 0.12 },
        { freq: 880, at: 0.09, duration: 0.12 },
      ]);

      expect(played).toBe(true);
      const context = FakeAudioContext.instances[0];
      expect(context?.createOscillator).toHaveBeenCalledTimes(2);
    });

    it('rend false, ne programme rien et tente la reprise quand le contexte est suspendu', async () => {
      FakeAudioContext.initialState = 'suspended';
      FakeAudioContext.resumeUnlocks = false;
      const { playTones } = await importAudio();

      const played = playTones([{ freq: 660, at: 0, duration: 0.12 }]);

      expect(played).toBe(false);
      const context = FakeAudioContext.instances[0];
      expect(context?.createOscillator).not.toHaveBeenCalled();
      expect(context?.resume).toHaveBeenCalledTimes(1);
    });

    it('rend false sans API Web Audio, sans lever', async () => {
      delete w.AudioContext;
      delete w.webkitAudioContext;
      const { playTones } = await importAudio();

      expect(playTones([{ freq: 660, at: 0, duration: 0.12 }])).toBe(false);
    });
  });

  describe('playClip', () => {
    it('décode une URL data: et démarre une source (rend la durée)', async () => {
      const { playClip } = await importAudio();

      const duration = await playClip('data:audio/ogg;base64,AAAA');

      expect(duration).toBe(1.5);
      const context = FakeAudioContext.instances[0];
      expect(context?.decodeAudioData).toHaveBeenCalledTimes(1);
      const source = context?.createBufferSource.mock.results[0]?.value as
        | FakeBufferSource
        | undefined;
      expect(source?.start).toHaveBeenCalledTimes(1);
    });

    it('accepte aussi du base64 brut (sans préfixe data:)', async () => {
      const { playClip } = await importAudio();

      await expect(playClip('AAAA')).resolves.toBe(1.5);
    });

    it('reprend un contexte suspendu avant de jouer', async () => {
      FakeAudioContext.initialState = 'suspended';
      const { playClip } = await importAudio();

      await expect(playClip('AAAA')).resolves.toBe(1.5);
      expect(FakeAudioContext.instances[0]?.resume).toHaveBeenCalled();
    });

    it('rejette sans API Web Audio', async () => {
      delete w.AudioContext;
      delete w.webkitAudioContext;
      const { playClip } = await importAudio();

      await expect(playClip('AAAA')).rejects.toThrow();
    });

    it('rejette quand le contexte reste verrouillé (aucun geste utilisateur)', async () => {
      FakeAudioContext.initialState = 'suspended';
      FakeAudioContext.resumeUnlocks = false;
      const { playClip } = await importAudio();

      await expect(playClip('AAAA')).rejects.toThrow();
      const context = FakeAudioContext.instances[0];
      expect(
        (context?.createBufferSource as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(0);
    });
  });
});
