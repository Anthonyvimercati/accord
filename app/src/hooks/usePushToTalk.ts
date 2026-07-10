/**
 * Appui-pour-parler : en salon vocal avec l'option active, le micro démarre
 * coupé et n'est rétabli que pendant l'appui sur la touche configurée. La
 * logique pure (`createPttController`) est testée en isolation ; le hook la
 * câble aux événements clavier globaux et au store vocal.
 */

import { useEffect } from 'react';
import { useUi } from '../stores/ui';
import { useVoice } from '../stores/voice';

/** Effets requis par le contrôleur (injectables pour les tests). */
export interface PttEffects {
  /** Coupe (`true`) ou rétablit (`false`) le micro. */
  setMuted: (muted: boolean) => Promise<void>;
  /** Signale un échec de bascule micro (best effort, non bloquant). */
  onError: () => void;
}

/** Contrôleur d'appui-pour-parler, indépendant du DOM. */
export interface PttController {
  /** Entrée en mode appui-pour-parler : démarre micro coupé. */
  engage: () => void;
  keyDown: (event: { code: string; repeat: boolean }) => void;
  keyUp: (event: { code: string }) => void;
}

export function createPttController(key: string, effects: PttEffects): PttController {
  let held = false;
  const apply = (muted: boolean): void => {
    effects.setMuted(muted).catch(effects.onError);
  };
  return {
    engage: () => {
      held = false;
      apply(true);
    },
    keyDown: (event) => {
      if (event.code !== key || event.repeat || held) return;
      held = true;
      apply(false);
    },
    keyUp: (event) => {
      if (event.code !== key || !held) return;
      held = false;
      apply(true);
    },
  };
}

/** Libellé lisible d'un code de touche (`KeyV` → `V`, `Digit5` → `5`). */
export function formatKeyLabel(code: string): string {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  return code;
}

/**
 * Active l'appui-pour-parler quand un salon vocal est rejoint et que l'option
 * est cochée. En sortie de mode (option décochée, changement de touche ou de
 * salon), le micro reste coupé : réactivation manuelle, jamais de micro ouvert
 * à l'insu de l'utilisateur.
 */
export function usePushToTalk(onError: () => void): void {
  const inVoice = useVoice((s) => s.active !== null);
  const enabled = useUi((s) => s.pttEnabled);
  const key = useUi((s) => s.pttKey);

  useEffect(() => {
    if (!inVoice || !enabled) return;
    const controller = createPttController(key, {
      setMuted: (muted) => useVoice.getState().setMuted(muted),
      onError,
    });
    controller.engage();
    const down = (e: KeyboardEvent): void => controller.keyDown(e);
    const up = (e: KeyboardEvent): void => controller.keyUp(e);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [inVoice, enabled, key, onError]);
}
