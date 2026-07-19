/**
 * Présence des brouillons par conversation — couche RÉACTIVE au-dessus de la
 * persistance de `lib/drafts` (localStorage), pour que les listes (MP, salons)
 * puissent afficher un indicateur « brouillon en cours » sans relire le
 * stockage à chaque rendu. Seule la PRÉSENCE est tenue ici, jamais le texte :
 * le composeur reste l'unique propriétaire du contenu.
 */

import { create } from 'zustand';

/** Préfixe commun des clés de brouillon (voir `lib/drafts.draftKey`). */
const DRAFT_PREFIX = 'draft:';

/** Clés de brouillon non vides trouvées au démarrage (lecture tolérante). */
function scanInitial(): Record<string, true> {
  const keys: Record<string, true> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key === null || !key.startsWith(DRAFT_PREFIX)) continue;
      if ((window.localStorage.getItem(key) ?? '').trim() !== '') keys[key] = true;
    }
  } catch {
    // Stockage indisponible : aucun indicateur, le composeur reste fonctionnel.
  }
  return keys;
}

interface DraftsState {
  /** Clés de brouillon actuellement non vides. */
  keys: Record<string, true>;
  /** Signale l'état du brouillon d'une clé (appelé par le composeur). */
  noteDraft: (key: string | null, hasText: boolean) => void;
}

export const useDrafts = create<DraftsState>((set) => ({
  keys: scanInitial(),
  noteDraft: (key, hasText) =>
    set((s) => {
      if (key === null || (s.keys[key] === true) === hasText) return s;
      const next = { ...s.keys };
      if (hasText) next[key] = true;
      else delete next[key];
      return { keys: next };
    }),
}));

/** Vrai si la clé a un brouillon non vide (sélecteur de commodité). */
export function hasDraft(keys: Record<string, true>, key: string | null): boolean {
  return key !== null && keys[key] === true;
}
