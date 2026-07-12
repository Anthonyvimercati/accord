/**
 * Machine à états de VoiceRecorder : démarrage (permission refusée / API
 * absente), ticks pendant la capture, arrêt manuel (`onStop` « manual »),
 * annulation (jamais `onStop`, micro toujours relâché), bornes automatiques
 * (durée 120 s, poids 5 Mio) et courses pendant `getUserMedia` (cancel/stop
 * avant que le flux n'arrive, `onStart` au vrai démarrage).
 * `MediaRecorder`/`getUserMedia` sont simulés : absents de jsdom.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RECORD_BYTES,
  MAX_RECORD_MS,
  pickAudioMimeType,
  VoiceRecorder,
  voiceDurationFromName,
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
  // jsdom rend toujours '' : par défaut, tout candidat est réputé décodable.
  vi.spyOn(window.HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = new Set(['audio/webm;codecs=opus']);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pickAudioMimeType / voiceFileName / voiceDurationFromName', () => {
  it('choisit le premier type enregistrable ET décodable, extension de repli dérivée', () => {
    installBrowserMocks(vi.fn());

    expect(pickAudioMimeType()).toBe('audio/webm;codecs=opus');
    expect(voiceFileName('audio/webm;codecs=opus', 3000)).toBe('voice-3s.webm');
    expect(voiceFileName('audio/ogg;codecs=opus', 3000)).toBe('voice-3s.ogg');
    expect(voiceFileName('audio/mp4', 3000)).toBe('voice-3s.m4a');
  });

  it('préfère AAC/MP4 quand l’enregistreur le supporte (portabilité inter-moteurs)', () => {
    installBrowserMocks(vi.fn());
    FakeMediaRecorder.supported = new Set([
      'audio/mp4;codecs=mp4a.40.2',
      'audio/webm;codecs=opus',
    ]);

    expect(pickAudioMimeType()).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  it('écarte un type enregistrable mais indécodable (canPlayType vide)', () => {
    installBrowserMocks(vi.fn());
    FakeMediaRecorder.supported = new Set([
      'audio/mp4;codecs=mp4a.40.2',
      'audio/webm;codecs=opus',
    ]);
    vi.spyOn(window.HTMLMediaElement.prototype, 'canPlayType').mockImplementation(
      (type: string) => (type.includes('webm') ? 'probably' : ''),
    );

    expect(pickAudioMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('rend une chaîne vide sans MediaRecorder', () => {
    vi.unstubAllGlobals();
    expect(pickAudioMimeType()).toBe('');
  });

  it('embarque la durée dans le nom et sait la relire (une décimale au plus)', () => {
    expect(voiceFileName('audio/mp4', 12_440)).toBe('voice-12.4s.m4a');
    expect(voiceDurationFromName('voice-12.4s.m4a')).toBe(12.4);
    expect(voiceDurationFromName('voice-3s.webm')).toBe(3);
    // Anciens messages et noms hors convention : pas de durée.
    expect(voiceDurationFromName('voice-message.webm')).toBeNull();
    expect(voiceDurationFromName('piece.mp3')).toBeNull();
    expect(voiceDurationFromName('voice-0s.webm')).toBeNull();
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

describe('VoiceRecorder — courses pendant getUserMedia', () => {
  /** getUserMedia contrôlé : le test décide quand le flux arrive. */
  function pendingGetUserMedia(): {
    release: (stream: FakeStream) => void;
    fail: () => void;
    getUserMedia: () => Promise<FakeStream>;
  } {
    let release!: (stream: FakeStream) => void;
    let fail!: () => void;
    const promise = new Promise<FakeStream>((resolve, reject) => {
      release = resolve;
      fail = () => reject(new Error('NotAllowedError'));
    });
    return { release, fail, getUserMedia: () => promise };
  }

  it('cancel() pendant getUserMedia : flux relâché, jamais ressuscité (ni tick ni onStop)', async () => {
    const stream = new FakeStream();
    const pending = pendingGetUserMedia();
    installBrowserMocks(vi.fn(pending.getUserMedia));
    const onTick = vi.fn();
    const onStop = vi.fn();
    const recorder = new VoiceRecorder({ onTick, onStop, onError: vi.fn() });

    const started = recorder.start();
    recorder.cancel();
    pending.release(stream);
    await started;

    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    // Pas de minuteur fantôme : ni tick, ni envoi automatique à la borne.
    await vi.advanceTimersByTimeAsync(MAX_RECORD_MS + 10);
    expect(onTick).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('cancel() pendant getUserMedia puis refus du micro : aucun onError (plus personne n’écoute)', async () => {
    const pending = pendingGetUserMedia();
    installBrowserMocks(vi.fn(pending.getUserMedia));
    const onError = vi.fn();
    const recorder = new VoiceRecorder({ onTick: vi.fn(), onStop: vi.fn(), onError });

    const started = recorder.start();
    recorder.cancel();
    pending.fail();
    await started;

    expect(onError).not.toHaveBeenCalled();
  });

  it('stop() pendant getUserMedia : finalisé dès que le MediaRecorder existe', async () => {
    const stream = new FakeStream();
    const pending = pendingGetUserMedia();
    installBrowserMocks(vi.fn(pending.getUserMedia));
    const onStop = vi.fn();
    const recorder = new VoiceRecorder({ onTick: vi.fn(), onStop, onError: vi.fn() });

    const started = recorder.start();
    recorder.stop();
    expect(onStop).not.toHaveBeenCalled();
    pending.release(stream);
    await started;

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop.mock.calls[0]?.[0]).toMatchObject({ reason: 'manual' });
    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
  });

  it('onStart n’est rappelé qu’au vrai démarrage de la capture (base du compteur)', async () => {
    const stream = new FakeStream();
    const pending = pendingGetUserMedia();
    installBrowserMocks(vi.fn(pending.getUserMedia));
    const onStart = vi.fn();
    const onTick = vi.fn();
    const recorder = new VoiceRecorder({ onStart, onTick, onStop: vi.fn(), onError: vi.fn() });

    const started = recorder.start();
    expect(onStart).not.toHaveBeenCalled();
    expect(onTick).not.toHaveBeenCalled();
    pending.release(stream);
    await started;

    expect(onStart).toHaveBeenCalledTimes(1);
    // Les ticks ne démarrent qu'après le vrai début de capture.
    await vi.advanceTimersByTimeAsync(500);
    expect(onTick).toHaveBeenCalled();
  });
});
