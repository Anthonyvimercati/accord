/**
 * Machine à états de VoiceRecorder : démarrage (permission refusée / API
 * absente), ticks pendant la capture, arrêt manuel (`onStop` « manual »),
 * annulation (jamais `onStop`, micro toujours relâché) et bornes
 * automatiques (durée 120 s, poids 5 Mio). `MediaRecorder`/`getUserMedia`
 * sont simulés : absents de jsdom.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RECORD_BYTES,
  MAX_RECORD_MS,
  pickAudioMimeType,
  VoiceRecorder,
  voiceFileName,
} from './voiceRecorder';

/** Piste factice : ne fait que noter qu'elle a été arrêtée. */
class FakeTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeStream {
  tracks: FakeTrack[];
  constructor(n = 1) {
    this.tracks = Array.from({ length: n }, () => new FakeTrack());
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

/** MediaRecorder factice, pilotable depuis les tests (dataavailable/stop à la demande). */
class FakeMediaRecorder {
  static supported = new Set(['audio/webm;codecs=opus']);
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.has(type);
  }
  static instances: FakeMediaRecorder[] = [];

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: { size: number } }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    public stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  /** Simule la fin réelle d'un MediaRecorder : un dernier `dataavailable`, puis `stop`. */
  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: { size: 0 } });
    this.onstop?.();
  }

  /** Aide de test : simule un `dataavailable` périodique d'un poids donné. */
  emitData(size: number): void {
    this.ondataavailable?.({ data: { size } });
  }
}

function installBrowserMocks(getUserMedia: (...args: unknown[]) => Promise<FakeStream>): void {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pickAudioMimeType / voiceFileName', () => {
  it('choisit le premier type supporté et en dérive une extension de repli', () => {
    installBrowserMocks(vi.fn());

    expect(pickAudioMimeType()).toBe('audio/webm;codecs=opus');
    expect(voiceFileName('audio/webm;codecs=opus')).toBe('voice-message.webm');
    expect(voiceFileName('audio/ogg;codecs=opus')).toBe('voice-message.ogg');
    expect(voiceFileName('audio/mp4')).toBe('voice-message.m4a');
  });

  it('rend une chaîne vide sans MediaRecorder', () => {
    vi.unstubAllGlobals();
    expect(pickAudioMimeType()).toBe('');
  });
});

describe('VoiceRecorder — démarrage impossible', () => {
  it('signale permission_denied sans planter quand getUserMedia est refusé', async () => {
    installBrowserMocks(
      vi.fn(async () => {
        throw new Error('NotAllowedError');
      }),
    );
    const onError = vi.fn();
    const recorder = new VoiceRecorder({ onTick: vi.fn(), onStop: vi.fn(), onError });

    await recorder.start();

    expect(onError).toHaveBeenCalledWith('permission_denied');
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('signale unsupported quand getUserMedia est absent de ce navigateur', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
    });
    const onError = vi.fn();
    const recorder = new VoiceRecorder({ onTick: vi.fn(), onStop: vi.fn(), onError });

    await recorder.start();

    expect(onError).toHaveBeenCalledWith('unsupported');
  });

  it('relâche le micro et signale unsupported si le MediaRecorder refuse de se construire', async () => {
    const stream = new FakeStream();
    vi.stubGlobal(
      'MediaRecorder',
      class {
        static isTypeSupported = FakeMediaRecorder.isTypeSupported;
        constructor() {
          throw new Error('mimeType non supporté');
        }
      },
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(async () => stream) },
      configurable: true,
    });
    const onError = vi.fn();
    const recorder = new VoiceRecorder({ onTick: vi.fn(), onStop: vi.fn(), onError });

    await recorder.start();

    expect(onError).toHaveBeenCalledWith('unsupported');
    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
  });
});

describe('VoiceRecorder — cycle de vie', () => {
  it('émet des ticks puis onStop (reason "manual") à l’arrêt volontaire, micro relâché', async () => {
    const stream = new FakeStream();
    installBrowserMocks(vi.fn(async () => stream));
    const onTick = vi.fn();
    const onStop = vi.fn();
    const recorder = new VoiceRecorder({ onTick, onStop, onError: vi.fn() });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(onTick).toHaveBeenCalled();

    recorder.stop();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop.mock.calls[0]?.[0]).toMatchObject({
      reason: 'manual',
      mime: 'audio/webm;codecs=opus',
    });
    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
  });

  it('annule sans jamais déclencher onStop, relâche le micro et jette les octets', async () => {
    const stream = new FakeStream();
    installBrowserMocks(vi.fn(async () => stream));
    const onStop = vi.fn();
    const recorder = new VoiceRecorder({ onTick: vi.fn(), onStop, onError: vi.fn() });

    await recorder.start();
    const instance = FakeMediaRecorder.instances[0];
    instance?.emitData(1024);

    recorder.cancel();

    expect(onStop).not.toHaveBeenCalled();
    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
  });

  it('n’appelle pas onStop une seconde fois si stop() est suivi de cancel()', async () => {
    const stream = new FakeStream();
    installBrowserMocks(vi.fn(async () => stream));
    const onStop = vi.fn();
    const recorder = new VoiceRecorder({ onTick: vi.fn(), onStop, onError: vi.fn() });

    await recorder.start();
    recorder.stop();
    recorder.cancel();

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('arrête automatiquement à la durée maximale (reason "max_duration")', async () => {
    const stream = new FakeStream();
    installBrowserMocks(vi.fn(async () => stream));
    const onStop = vi.fn();
    const recorder = new VoiceRecorder({ onTick: vi.fn(), onStop, onError: vi.fn() });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(MAX_RECORD_MS + 10);

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop.mock.calls[0]?.[0]).toMatchObject({ reason: 'max_duration' });
  });

  it('arrête automatiquement au-delà du poids maximal (reason "max_bytes")', async () => {
    const stream = new FakeStream();
    installBrowserMocks(vi.fn(async () => stream));
    const onStop = vi.fn();
    const recorder = new VoiceRecorder({ onTick: vi.fn(), onStop, onError: vi.fn() });

    await recorder.start();
    const instance = FakeMediaRecorder.instances[0];
    instance?.emitData(MAX_RECORD_BYTES);

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop.mock.calls[0]?.[0]).toMatchObject({ reason: 'max_bytes' });
  });
});
