/**
 * Son de notification : un bref « blip » à deux notes synthétisé via l'API
 * Web Audio — aucun asset binaire, budget de bundle intact. Le contexte
 * audio n'est créé qu'au premier appel (jamais au chargement du module, donc
 * un simple `import` ne touche jamais le matériel audio), se réactive au
 * premier geste utilisateur si le navigateur l'a démarré suspendu
 * (politique de lecture automatique), et la lecture est limitée à une fois
 * par seconde même en rafale. Toute défaillance (API absente, lecture
 * bloquée, contexte refusé) est silencieuse : un son manqué ne doit jamais
 * casser la livraison des messages.
 */

import { useUi } from '../stores/ui';

export type NotificationSoundKind = 'message' | 'mention';

const THROTTLE_MS = 1000;
const NOTE_DURATION_S = 0.12;
const NOTE_GAP_S = 0.09;

let ctx: AudioContext | null = null;
let unlockArmed = false;
let lastPlayedAtMs = 0;

/** Deux notes (Hz) par nature de notification ; la mention sonne plus haut/vif. */
function notesFor(kind: NotificationSoundKind): readonly [number, number] {
  return kind === 'mention' ? [880, 1174.66] : [660, 880];
}

/** Constructeur `AudioContext` disponible (préfixé Safari inclus), ou `null`. */
function resolveAudioContextCtor(): typeof AudioContext | null {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Contexte partagé, créé au premier besoin ; `null` si l'API est indisponible. */
function ensureContext(): AudioContext | null {
  if (ctx !== null) return ctx;
  const Ctor = resolveAudioContextCtor();
  if (Ctor === null) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Réarme la reprise du contexte suspendu au prochain geste utilisateur. */
function armAutoplayUnlock(context: AudioContext): void {
  if (unlockArmed) return;
  unlockArmed = true;
  const resume = (): void => {
    unlockArmed = false;
    context.resume().catch(() => {
      // Best effort : reste suspendu jusqu'au prochain geste.
    });
  };
  window.addEventListener('pointerdown', resume, { once: true });
  window.addEventListener('keydown', resume, { once: true });
}

/** Joue une note (sinusoïde, enveloppe attaque/chute courte) à `startAt`. */
function playTone(context: AudioContext, freq: number, startAt: number): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.2, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + NOTE_DURATION_S);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(startAt);
  osc.stop(startAt + NOTE_DURATION_S + 0.02);
}

/**
 * Joue le blip de notification, limité à une fois par seconde — une rafale
 * de messages entrants ne doit jamais empiler les sons. Ne lève jamais :
 * no-op silencieux sans support Web Audio ou pendant un blocage de lecture
 * automatique (réarmé pour le prochain geste utilisateur), ou si l'utilisateur
 * a coupé les sons de notification (Paramètres → Notifications).
 */
export function playNotificationSound(kind: NotificationSoundKind = 'message'): void {
  if (!useUi.getState().notifySoundEnabled) return;
  const now = Date.now();
  if (now - lastPlayedAtMs < THROTTLE_MS) return;
  try {
    const context = ensureContext();
    if (context === null) return;
    if (context.state === 'suspended') {
      armAutoplayUnlock(context);
      void context.resume().catch(() => {
        // Best effort : armAutoplayUnlock couvre le prochain geste.
      });
    }
    lastPlayedAtMs = now;
    const [first, second] = notesFor(kind);
    const start = context.currentTime;
    playTone(context, first, start);
    playTone(context, second, start + NOTE_GAP_S);
  } catch {
    // Best effort : un son de notification manqué ne casse jamais l'appli.
  }
}
