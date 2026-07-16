/**
 * Enregistrement de messages vocaux (`getUserMedia` + `MediaRecorder`) :
 * capture micro bornée en durée (120 s) et en poids (5 Mio — sous la limite
 * de 8 Mio de `files.share_bytes`/`files.read`, voir `lib/attachments.ts`) ;
 * un dépassement de l'une ou l'autre borne arrête et finalise l'enregistrement
 * au lieu d'échouer. Le flux micro est toujours relâché (arrêt des pistes) à
 * l'arrêt, à l'annulation ou en cas d'erreur — jamais d'indicateur micro
 * fantôme après coup.
 *
 * Machine à états : `settled` reste souverain à travers les `await` de
 * `start()` — un `cancel()` pendant l'attente du micro ne ressuscite jamais
 * l'enregistrement, et un `stop()` pendant cette attente est honoré dès que
 * le `MediaRecorder` existe (finalisation immédiate). `onStart` signale le
 * vrai début de capture (base du compteur côté UI).
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

/**
 * Types MIME candidats, ordonnés pour la portabilité inter-moteurs : un blob
 * enregistré ici doit être décodable chez le pair, qui peut tourner sur un
 * autre moteur (WKWebView macOS, WebView2 Windows, WebKitGTK Linux). AAC/MP4
 * d'abord — c'est le format le plus largement décodé (WKWebView ne lit pas
 * WebM/Opus) ; Opus compresse mieux la voix à bas débit mais reste un repli.
 */
const CANDIDATE_MIME_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const;

/**
 * Sonde le premier type MIME que ce moteur sait à la fois ENREGISTRER
 * (`MediaRecorder.isTypeSupported`) et DÉCODER (`Audio#canPlayType`) — un
 * type enregistrable mais indécodable localement serait a fortiori illisible
 * chez la plupart des pairs. Chaîne vide si aucun candidat ne passe les deux
 * sondes, ou si l'API est absente.
 */
export function pickAudioMimeType(): string {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {
    return '';
  }
  const probe = typeof Audio !== 'undefined' ? new Audio() : null;
  const decodable = (type: string): boolean =>
    probe === null || typeof probe.canPlayType !== 'function'
      ? true // Sonde de décodage absente : on retombe sur la seule sonde d'enregistrement.
      : probe.canPlayType(type) !== '';
  return (
    CANDIDATE_MIME_TYPES.find(
      (type) => MediaRecorder.isTypeSupported(type) && decodable(type),
    ) ?? ''
  );
}

/** Extension de fichier plausible pour un type MIME de capture audio. */
function extensionForMime(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

/**
 * Nom de fichier conventionnel d'un message vocal : `voice-<durée>s.<ext>`
 * (ex. `voice-12.4s.m4a`, une décimale au plus). La durée est embarquée dans
 * le nom car les blobs `MediaRecorder` n'ont pas d'en-tête de durée
 * (`audio.duration` = Infinity) — le lecteur la relit via
 * `voiceDurationFromName`. La détection au rendu (`Attachments.tsx`) se fait
 * par type MIME (`audio/*`), pas par ce nom.
 */
export function voiceFileName(mime: string, durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 100) / 10);
  return `voice-${seconds}s.${extensionForMime(mime)}`;
}

/**
 * Relit la durée (en secondes) embarquée dans un nom de pièce vocale par
 * `voiceFileName`. `null` si le nom ne suit pas la convention (anciens
 * messages `voice-message.webm`, pièce renommée par le pair).
 */
export function voiceDurationFromName(name: string): number | null {
  const match = /^voice-(\d+(?:\.\d+)?)s\./.exec(name);
  if (match === null) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
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
  /** Capture réellement démarrée (micro obtenu, `MediaRecorder` lancé). */
  onStart?: () => void;
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
  /**
   * Issue déjà réglée (finalisation ou annulation) : souverain, jamais remis
   * à `false` — y compris à travers les `await` de `start()`, sinon une
   * annulation pendant `getUserMedia` ressusciterait l'enregistrement.
   */
  private settled = false;
  /** `stop()` reçu pendant l'attente du micro : à honorer dès que possible. */
  private stopRequested = false;

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
      // Annulé pendant l'attente : l'échec du micro n'intéresse plus personne.
      if (!this.settled) this.callbacks.onError('permission_denied');
      return;
    }
    if (this.settled) {
      // `cancel()` pendant l'attente du micro : flux relâché immédiatement,
      // l'enregistrement ne ressuscite jamais (ni timers, ni MediaRecorder).
      this.stopTracks(stream);
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
      recorder =
        mime !== ''
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
    } catch {
      this.stopTracks(stream);
      this.callbacks.onError('unsupported');
      return;
    }

    this.stream = stream;
    this.recorder = recorder;
    this.mime = mime !== '' ? mime : recorder.mimeType || 'audio/webm';

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
    this.callbacks.onStart?.();
    if (this.stopRequested) {
      // `stop()` pendant l'attente du micro : honoré maintenant que le
      // MediaRecorder existe — finalisation immédiate, pas de timers.
      this.stop();
      return;
    }
    this.tickTimer = setInterval(() => {
      this.callbacks.onTick(Date.now() - this.startedAt);
    }, TICK_INTERVAL_MS);
    this.limitTimer = setTimeout(() => {
      this.stopReason = 'max_duration';
      this.stop();
    }, MAX_RECORD_MS);
  }

  /**
   * Arrête et finalise : `onStop` se déclenche une fois les derniers octets
   * reçus. Pendant l'attente du micro (`start()` en cours), la demande est
   * mémorisée et honorée dès que le `MediaRecorder` existe — jamais perdue.
   */
  stop(): void {
    if (this.settled) return;
    this.clearTimers();
    if (this.recorder === null) {
      this.stopRequested = true;
      return;
    }
    if (this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
  }

  /** Arrête sans finaliser : octets jetés, micro relâché, `onStop` jamais appelé. */
  cancel(): void {
    this.clearTimers();
    this.settled = true;
    this.stopRequested = false;
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
