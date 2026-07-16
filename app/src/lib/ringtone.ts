/**
 * Sonnerie d'appel entrant : deux notes courtes répétées toutes les ~2 s tant
 * que `stopRingtone` n'est pas appelé, jouées sur le contexte Web Audio
 * partagé (`lib/audio.ts`). Chaque cycle repasse par `playTones`, qui
 * revérifie l'état du contexte et relance sa reprise : une sonnerie démarrée
 * dans un contexte encore verrouillé (autoplay WKWebView, état `interrupted`
 * compris) devient audible dès le déverrouillage, au cycle suivant.
 * Contrairement au blip de notification, jouée en boucle explicite (pas de
 * limitation de fréquence — elle DOIT sonner tant que l'appel sonne) et gardée
 * par la préférence de son ET l'absence de Ne pas déranger (l'appelant voit
 * toujours l'overlay d'appel entrant en DND, seul le son est coupé — voir
 * `IncomingCall.tsx`). Toute défaillance est silencieuse : une sonnerie
 * manquée ne doit jamais empêcher de répondre à l'appel.
 */

import { useFriends } from '../stores/friends';
import { useUi } from '../stores/ui';
import { ensureRunning, playTones } from './audio';

const RING_INTERVAL_MS = 2000;
const NOTE_DURATION_S = 0.32;
const NOTE_GAP_S = 0.4;
const RING_PEAK = 0.22;
const RING_ATTACK_S = 0.02;

let ringTimer: ReturnType<typeof setInterval> | null = null;

/** Un cycle de sonnerie : deux notes (façon téléphone), C5 puis E5. */
function playRingOnce(): void {
  playTones([
    {
      freq: 523.25,
      at: 0,
      duration: NOTE_DURATION_S,
      peak: RING_PEAK,
      attack: RING_ATTACK_S,
    },
    {
      freq: 659.25,
      at: NOTE_GAP_S,
      duration: NOTE_DURATION_S,
      peak: RING_PEAK,
      attack: RING_ATTACK_S,
    },
  ]);
}

/** Vrai si le son est autorisé : préférence utilisateur ET pas de Ne pas déranger. */
function ringtoneAllowed(): boolean {
  return useUi.getState().notifySoundEnabled && useFriends.getState().ownStatus !== 'dnd';
}

/**
 * Démarre la sonnerie en boucle (no-op si déjà en cours, si le son de
 * notification est coupé, en Ne pas déranger, ou sans support Web Audio).
 * Idempotent : plusieurs appels successifs ne cumulent pas les minuteurs.
 */
export function startRingtone(): void {
  if (ringTimer !== null) return;
  if (!ringtoneAllowed()) return;
  // Sans API Web Audio, inutile d'armer un minuteur qui ne sonnera jamais.
  if (ensureRunning() === null) return;
  playRingOnce();
  // Chaque cycle revérifie/reprend le contexte (via playTones → ensureRunning) :
  // la sonnerie devient audible dès que l'audio est déverrouillé.
  ringTimer = setInterval(playRingOnce, RING_INTERVAL_MS);
}

/** Arrête la sonnerie immédiatement (no-op si déjà arrêtée). */
export function stopRingtone(): void {
  if (ringTimer === null) return;
  clearInterval(ringTimer);
  ringTimer = null;
}
