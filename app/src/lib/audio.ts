/**
 * Contexte Web Audio partagé de l'application : UN seul `AudioContext` pour
 * tous les sons synthétisés (blip de notification, sonnerie d'appel) et les
 * clips décodés (soundboard). Créé au premier besoin — jamais au chargement
 * du module, un simple `import` ne touche pas le matériel audio.
 *
 * La WKWebView (Tauri/macOS) démarre souvent le contexte `suspended`
 * (politique de lecture automatique) et le passe parfois dans l'état NON
 * STANDARD `interrupted` (interruption système WebKit) : les deux exigent un
 * `resume()`, idéalement porté par un geste utilisateur. `armAudioUnlock`
 * s'arme une fois au démarrage de l'appli et reprend le contexte à chaque
 * pointer/clavier — le contexte tourne donc avant le premier événement
 * (message entrant, soundboard distant) sans geste dédié au son.
 *
 * Deux primitives de lecture :
 * - `playTones` : notes synthétisées (oscillateur + enveloppe), programmées
 *   uniquement si le contexte tourne (rend `false` sinon, après une tentative
 *   de reprise) — l'appelant sait si le son a réellement été joué ;
 * - `playClip` : clip encodé (URL `data:` ou base64 brut) décodé via
 *   `decodeAudioData` puis joué par un `AudioBufferSourceNode` — contourne à
 *   la fois la CSP `media-src` et la politique d'autoplay des éléments
 *   `<audio>` (un contexte déverrouillé une fois joue sans nouveau geste).
 */

/** Une note à programmer : fréquence, décalage/durée (s) et enveloppe. */
export interface Tone {
  /** Fréquence (Hz). */
  freq: number;
  /** Décalage de départ (s), relatif à l'instant de l'appel. */
  at: number;
  /** Durée de la note (s), enveloppe de chute comprise. */
  duration: number;
  /** Gain crête de l'enveloppe (défaut 0.2). */
  peak?: number;
  /** Durée de l'attaque (s, défaut 0.01). */
  attack?: number;
}

const PEAK_DEFAULT = 0.2;
const ATTACK_DEFAULT = 0.01;
/** Marge d'arrêt de l'oscillateur après la fin de l'enveloppe (s). */
const STOP_MARGIN_S = 0.02;

let ctx: AudioContext | null = null;
let unlockArmed = false;

/** Constructeur `AudioContext` disponible (préfixé Safari inclus), ou `null`. */
function resolveAudioContextCtor(): typeof AudioContext | null {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Contexte partagé, créé au premier besoin ; `null` si l'API est indisponible. */
export function getAudioContext(): AudioContext | null {
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

/**
 * Vrai si l'état demande un `resume()` : `suspended` (autoplay) mais aussi
 * `interrupted`, état WebKit non standard jamais couvert par un simple
 * `state === 'suspended'` — cause historique de sons muets en WKWebView.
 */
function needsResume(state: string): boolean {
  return state === 'suspended' || state === 'interrupted';
}

/**
 * Rend le contexte partagé en tentant de le remettre en route s'il est
 * suspendu/interrompu (best effort, sans attendre la promesse). L'appelant
 * vérifie `state === 'running'` s'il a besoin de la garantie.
 */
export function ensureRunning(): AudioContext | null {
  const context = getAudioContext();
  if (context === null) return null;
  if (needsResume(context.state)) {
    context.resume().catch(() => {
      // Best effort : le prochain geste utilisateur retentera (armAudioUnlock).
    });
  }
  return context;
}

/**
 * Arme UNE fois, au démarrage de l'appli, le déverrouillage du contexte :
 * chaque pointer/clavier crée le contexte au besoin et le reprend s'il est
 * suspendu/interrompu. Écouteurs persistants (pas `once`) : la WKWebView peut
 * re-suspendre le contexte en cours de session (`interrupted`), le geste
 * suivant le ranime. Idempotent.
 */
export function armAudioUnlock(): void {
  if (unlockArmed) return;
  unlockArmed = true;
  const onGesture = (): void => {
    ensureRunning();
  };
  window.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
  window.addEventListener('keydown', onGesture, { capture: true, passive: true });
}

/**
 * Programme une suite de notes synthétisées (sinusoïde, enveloppe
 * attaque/chute). Rend `true` si les notes ont réellement été programmées ;
 * `false` si l'API est absente ou si le contexte n'est pas en route (une
 * reprise est alors tentée pour l'appel suivant) — programmer dans un
 * contexte suspendu empilerait des sons fantômes joués en rafale à la
 * reprise. Ne lève jamais.
 */
export function playTones(tones: readonly Tone[]): boolean {
  try {
    const context = ensureRunning();
    if (context === null || context.state !== 'running') return false;
    const base = context.currentTime;
    for (const tone of tones) {
      const startAt = base + tone.at;
      const peak = tone.peak ?? PEAK_DEFAULT;
      const attack = tone.attack ?? ATTACK_DEFAULT;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.value = tone.freq;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(peak, startAt + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(startAt);
      osc.stop(startAt + tone.duration + STOP_MARGIN_S);
    }
    return true;
  } catch {
    // Best effort : un son manqué ne casse jamais l'appli.
    return false;
  }
}

/** Octets base64 → tampon binaire (pour `decodeAudioData`). */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Charge utile base64 d'une URL `data:` (ou l'entrée telle quelle). */
function extractBase64(dataUrlOrBase64: string): string {
  if (!dataUrlOrBase64.startsWith('data:')) return dataUrlOrBase64;
  return dataUrlOrBase64.slice(dataUrlOrBase64.indexOf(',') + 1);
}

/**
 * Joue un clip audio encodé (URL `data:` ou base64 brut — le codec est
 * reconnu par `decodeAudioData`, aucun type MIME requis) sur le contexte
 * partagé. Résout avec la durée du clip (s) une fois la lecture démarrée ;
 * rejette si l'API est absente, si le décodage échoue ou si le contexte
 * reste verrouillé (aucun geste utilisateur n'a encore déverrouillé l'audio).
 */
export async function playClip(dataUrlOrBase64: string): Promise<number> {
  const context = ensureRunning();
  if (context === null) throw new Error('API Web Audio indisponible');
  const buffer = await context.decodeAudioData(base64ToArrayBuffer(extractBase64(dataUrlOrBase64)));
  // `ensureRunning` a lancé la reprise avant le décodage ; si le contexte ne
  // tourne toujours pas, la lecture serait silencieuse — on échoue clairement.
  if (context.state !== 'running') {
    throw new Error('contexte audio verrouillé (aucun geste utilisateur)');
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return buffer.duration;
}
