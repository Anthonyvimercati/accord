/**
 * Son de notification : un bref « blip » à deux notes synthétisé via le
 * contexte Web Audio partagé (`lib/audio.ts`) — aucun asset binaire, budget
 * de bundle intact. Le contexte n'est créé qu'au premier besoin et son
 * déverrouillage (autoplay WKWebView, y compris l'état non standard
 * `interrupted`) est géré par `armAudioUnlock`, armé au démarrage de l'appli.
 * La lecture est limitée à une fois par seconde même en rafale — et la
 * limitation n'est consommée QUE si le blip a réellement été programmé
 * (contexte en route) : un contexte encore verrouillé ne « mange » plus le
 * son. Toute défaillance (API absente, lecture bloquée) est silencieuse : un
 * son manqué ne doit jamais casser la livraison des messages.
 */

import { useUi } from '../stores/ui';
import { playTones } from './audio';

export type NotificationSoundKind = 'message' | 'mention';

const THROTTLE_MS = 1000;
const NOTE_DURATION_S = 0.12;
const NOTE_GAP_S = 0.09;

let lastPlayedAtMs = 0;

/** Deux notes (Hz) par nature de notification ; la mention sonne plus haut/vif. */
function notesFor(kind: NotificationSoundKind): readonly [number, number] {
  return kind === 'mention' ? [880, 1174.66] : [660, 880];
}

/**
 * Joue le blip de notification, limité à une fois par seconde — une rafale
 * de messages entrants ne doit jamais empiler les sons. Ne lève jamais :
 * no-op silencieux sans support Web Audio, pendant un blocage de lecture
 * automatique (le déverrouillage global couvre le prochain geste), ou si
 * l'utilisateur a coupé les sons de notification (Paramètres → Notifications).
 */
export function playNotificationSound(kind: NotificationSoundKind = 'message'): void {
  if (!useUi.getState().notifySoundEnabled) return;
  const now = Date.now();
  if (now - lastPlayedAtMs < THROTTLE_MS) return;
  const [first, second] = notesFor(kind);
  const played = playTones([
    { freq: first, at: 0, duration: NOTE_DURATION_S },
    { freq: second, at: NOTE_GAP_S, duration: NOTE_DURATION_S },
  ]);
  // Contexte suspendu/interrompu : rien n'a sonné, on ne consomme pas la
  // limitation — le prochain appel (contexte déverrouillé) jouera vraiment.
  if (played) lastPlayedAtMs = now;
}
