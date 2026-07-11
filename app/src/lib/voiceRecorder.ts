/**
 * Enregistrement de messages vocaux (`getUserMedia` + `MediaRecorder`) :
 * capture micro bornée en durée (120 s) et en poids (5 Mio — sous la limite
 * de 8 Mio de `files.share_bytes`/`files.read`, voir `lib/attachments.ts`) ;
 * un dépassement de l'une ou l'autre borne arrête et finalise l'enregistrement
 * au lieu d'échouer. Le flux micro est toujours relâché (arrêt des pistes) à
 * l'arrêt, à l'annulation ou en cas d'erreur — jamais d'indicateur micro
 * fantôme après coup.
 *
 * Un enregistreur = un enregistrement : créer une nouvelle instance de
 * `VoiceRecorder` à chaque prise plutôt que de réutiliser la précédente.
 */

/** Durée maximale d'un message vocal avant arrêt automatique. */
export const MAX_RECORD_MS = 120_000;

/** Poids maximal des octets capturés avant arrêt automatique (5 Mio). */
export const MAX_RECORD_BYTES = 5 * 1024 * 1024;

/** Intervalle des rappels `onTick` pendant l'enregistrement. */
const TICK_INTERVAL_MS = 200;

/**
 * Intervalle de `MediaRecorder.start(timeslice)` : assez court pour que la
 * borne de poids soit appliquée sans la dépasser largement une fois franchie.
 */
const DATA_INTERVAL_MS = 250;

/** Types MIME candidats par ordre de préférence (Opus dans WebM d'abord). */
const CANDIDATE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
] as const;

/**
 * Sonde le premier type MIME supporté par `MediaRecorder` (chaîne vide si
 * aucun candidat n'est supporté, ou si l'API est absente).
 */
export function pickAudioMimeType(): string {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {
    return '';
  }
  return CANDIDATE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

/** Extension de fichier plausible pour un type MIME de capture audio. */
function extensionForMime(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

/**
 * Nom de fichier conventionnel d'un message vocal. La détection au rendu
 * (`Attachments.tsx`) se fait par type MIME (`audio/*`), pas par ce nom —
 * il ne sert qu'à l'affichage / au téléchargement de repli.
 */
export function voiceFileName(mime: string): string {
  return `voice-message.${extensionForMime(mime)}`;
}

/** Cause de l'échec du démarrage d'un enregistrement. */
export type VoiceRecorderError = 'permission_denied' | 'unsupported';

/** Motif de la fin d'un enregistrement finalisé (jamais émis après `cancel()`). */
export type VoiceRecorderStopReason = 'manual' | 'max_duration' | 'max_bytes';

export interface VoiceRecorderResult {
  blob: Blob;
  mime: string;
  durationMs: number;
  reason: VoiceRecorderStopReason;
}

export interface VoiceRecorderCallbacks {
  /** Rappelé ~5 fois/s pendant l'enregistrement avec le temps écoulé (ms). */
  onTick: (elapsedMs: number) => void;
  /** Enregistrement finalisé (arrêt manuel ou borne atteinte). */
  onStop: (result: VoiceRecorderResult) => void;
  /** Démarrage impossible : permission refusée ou API indisponible. */
  onError: (error: VoiceRecorderError) => void;
}

export class VoiceRecorder {
  private readonly callbacks: VoiceRecorderCallbacks;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private mime = '';
  private startedAt = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private stopReason: VoiceRecorderStopReason = 'manual';
  /** Court-circuite `finish()` une fois l'issue déjà réglée (arrêt ou annulation). */
  private settled = false;

  constructor(callbacks: VoiceRecorderCallbacks) {
    this.callbacks = callbacks;
  }

  /** Démarre la capture : demande le micro puis initialise le `MediaRecorder`. */
  async start(): Promise<void> {
    if (
      typeof navigator === 'undefined' ||
      navigator.mediaDevices === undefined ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      this.callbacks.onError('unsupported');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.callbacks.onError('permission_denied');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      this.stopTracks(stream);
      this.callbacks.onError('unsupported');
      return;
    }
    const mime = pickAudioMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mime !== '' ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      this.stopTracks(stream);
      this.callbacks.onError('unsupported');
      return;
    }

    this.stream = stream;
    this.recorder = recorder;
    this.mime = mime !== '' ? mime : recorder.mimeType || 'audio/webm';
    this.chunks = [];
    this.bytes = 0;
    this.stopReason = 'manual';
    this.settled = false;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size === 0) return;
      this.chunks.push(event.data);
      this.bytes += event.data.size;
      if (this.bytes >= MAX_RECORD_BYTES) {
        this.stopReason = 'max_bytes';
        this.stop();
      }
    };
    recorder.onstop = () => this.finish();
    recorder.start(DATA_INTERVAL_MS);
    this.startedAt = Date.now();
    this.tickTimer = setInterval(() => {
      this.callbacks.onTick(Date.now() - this.startedAt);
    }, TICK_INTERVAL_MS);
    this.limitTimer = setTimeout(() => {
      this.stopReason = 'max_duration';
      this.stop();
    }, MAX_RECORD_MS);
  }

  /** Arrête et finalise : `onStop` se déclenche une fois les derniers octets reçus. */
  stop(): void {
    this.clearTimers();
    if (this.recorder !== null && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
  }

  /** Arrête sans finaliser : octets jetés, micro relâché, `onStop` jamais appelé. */
  cancel(): void {
    this.clearTimers();
    this.settled = true;
    if (this.recorder !== null && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    this.releaseStream();
    this.chunks = [];
  }

  private finish(): void {
    this.clearTimers();
    if (this.settled) {
      // `cancel()` est passé avant la fin réelle du MediaRecorder : rien à
      // finaliser, mais on relâche quand même le flux par sécurité.
      this.releaseStream();
      return;
    }
    this.settled = true;
    const durationMs = Date.now() - this.startedAt;
    const blob = new Blob(this.chunks, { type: this.mime });
    this.releaseStream();
    this.callbacks.onStop({ blob, mime: this.mime, durationMs, reason: this.stopReason });
  }

  private releaseStream(): void {
    if (this.stream !== null) this.stopTracks(this.stream);
    this.stream = null;
  }

  private stopTracks(stream: MediaStream): void {
    stream.getTracks().forEach((track) => track.stop());
  }

  private clearTimers(): void {
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    if (this.limitTimer !== null) clearTimeout(this.limitTimer);
    this.tickTimer = null;
    this.limitTimer = null;
  }
}
