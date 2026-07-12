/**
 * Utilitaires de focus des surfaces flottantes (modales, popovers, menus) :
 * énumération des éléments focusables et bouclage de Tab (piège à focus).
 * La restauration du focus au déclencheur reste à la charge de chaque
 * surface (capture de `document.activeElement` à l'ouverture).
 */

/** Éléments focusables (non désactivés) sous une racine, dans l'ordre DOM. */
export function focusables(racine: HTMLElement | null): HTMLElement[] {
  if (racine === null) return [];
  const selecteur =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  return Array.from(racine.querySelectorAll<HTMLElement>(selecteur));
}

/** Sous-ensemble minimal d'un évènement clavier (natif ou synthétique React). */
interface EvenementTab {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}

/**
 * Boucle Tab/Maj-Tab à l'intérieur de `racine` : au bord de la liste des
 * focusables, le focus revient à l'autre extrémité au lieu de s'échapper.
 * Si le focus est déjà hors de la racine (ex. perdu sur `body`), il est
 * ramené au premier élément.
 */
export function bouclerTab(e: EvenementTab, racine: HTMLElement | null): void {
  if (e.key !== 'Tab') return;
  const cibles = focusables(racine);
  const premier = cibles[0];
  const dernier = cibles[cibles.length - 1];
  if (premier === undefined || dernier === undefined) return;
  const actif = document.activeElement;
  if (racine !== null && (actif === null || !racine.contains(actif))) {
    e.preventDefault();
    premier.focus();
    return;
  }
  if (e.shiftKey && actif === premier) {
    e.preventDefault();
    dernier.focus();
  } else if (!e.shiftKey && actif === dernier) {
    e.preventDefault();
    premier.focus();
  }
}
