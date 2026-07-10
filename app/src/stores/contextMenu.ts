/**
 * Menu contextuel générique (clic droit) : store minimal ne portant que la
 * position d'ouverture et la liste d'items fournie par l'appelant — chaque
 * surface (message, utilisateur, salon, serveur…) construit ses propres
 * items en réutilisant les actions déjà existantes des stores de domaine,
 * sans dupliquer leur logique ici. Le rendu vit dans
 * `components/ContextMenu.tsx`, monté une fois dans `AppShell`.
 */

import { create } from 'zustand';
import type { ReactNode } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Style destructif (rouge) — suppression, départ d'un serveur… */
  danger?: boolean;
  /** Trait de séparation au-dessus de cet item (regroupement visuel). */
  separatorBefore?: boolean;
}

interface OpenContextMenu {
  /** Position d'ouverture (coordonnées viewport, `e.clientX/Y`). */
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuState {
  menu: OpenContextMenu | null;
  openMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  closeMenu: () => void;
}

export const useContextMenu = create<ContextMenuState>((set) => ({
  menu: null,
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),
}));

/**
 * Vrai si `target` est un champ de saisie natif (ou un contenu éditable) —
 * sert à préserver le copier/coller natif du navigateur : ni la suppression
 * globale du menu par défaut (`AppShell`), ni un menu contextuel maison ne
 * doivent s'y substituer.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('input, textarea, [contenteditable="true"]') !== null;
}
