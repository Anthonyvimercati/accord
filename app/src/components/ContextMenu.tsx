/**
 * Rendu du menu contextuel générique (voir `stores/contextMenu.ts`) : ouvert
 * au clic droit sur une surface prise en charge (message, utilisateur, salon,
 * serveur), positionné au curseur et borné au viewport — même schéma que
 * `ProfilePopover` (mesure réelle puis repositionnement). Se ferme au clic
 * extérieur, à Échap, au défilement d'un conteneur quelconque, ou à la perte
 * de focus de la fenêtre. Navigation clavier : flèches haut/bas déplacent le
 * focus (roving tabindex), Entrée active l'item courant.
 *
 * Exporte aussi le petit jeu d'icônes partagé par les différents menus
 * (message, utilisateur, salon, serveur) pour rester visuellement cohérent
 * sans dupliquer les tracés SVG à chaque site d'appel.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useContextMenu, type ContextMenuItem } from '../stores/contextMenu';

/** Marge minimale au bord du viewport (px), comme `ProfilePopover`. */
const MARGE = 8;

/** Position `fixed` (px) bornée au viewport, calée près du point de clic. */
function clamp(x: number, y: number, width: number, height: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: Math.max(MARGE, Math.min(x, vw - width - MARGE)),
    top: Math.max(MARGE, Math.min(y, vh - height - MARGE)),
  };
}

export function ContextMenu() {
  const menu = useContextMenu((s) => s.menu);
  const closeMenu = useContextMenu((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Repositionne après mesure réelle (largeur/hauteur variables selon les
  // items) et donne le focus au menu pour la navigation clavier.
  useLayoutEffect(() => {
    if (menu === null) {
      setPos(null);
      return;
    }
    setActiveIndex(-1);
    const el = ref.current;
    if (el === null) return;
    setPos(clamp(menu.x, menu.y, el.offsetWidth, el.offsetHeight));
    el.focus();
  }, [menu]);

  useEffect(() => {
    if (menu === null) return undefined;
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) closeMenu();
    };
    // Capture : un défilement dans n'importe quel conteneur (fil de
    // messages, liste de salons…) referme le menu — sa position au clic n'a
    // plus de sens une fois le contenu déplacé sous le curseur.
    const onScroll = (): void => closeMenu();
    window.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', closeMenu);
    return () => {
      window.removeEventListener('mousedown', onDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', closeMenu);
    };
  }, [menu, closeMenu]);

  if (menu === null) return null;
  const { items } = menu;

  const activate = (item: ContextMenuItem): void => {
    closeMenu();
    item.onClick();
  };

  const moveActive = (next: number): void => {
    const bounded = ((next % items.length) + items.length) % items.length;
    setActiveIndex(bounded);
    itemRefs.current[bounded]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveActive(activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(activeIndex - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      const item = items[activeIndex];
      if (item !== undefined) {
        e.preventDefault();
        activate(item);
      }
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        left: pos?.left ?? menu.x,
        top: pos?.top ?? menu.y,
        visibility: pos === null ? 'hidden' : 'visible',
      }}
      className="context-menu-enter z-50 min-w-[210px] max-w-xs origin-top-left rounded-md border border-rail bg-modal py-1.5 shadow-elevation focus:outline-none"
    >
      {items.map((item, i) => (
        <div key={`${i}-${item.label}`}>
          {item.separatorBefore === true && (
            <div className="my-1.5 h-px bg-input" role="separator" />
          )}
          <button
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={i === activeIndex ? 0 : -1}
            onMouseEnter={() => setActiveIndex(i)}
            onClick={() => activate(item)}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm font-medium transition-colors focus-visible:outline-none ${
              item.danger === true
                ? 'text-red hover:bg-red/10 focus-visible:bg-red/10'
                : 'text-norm hover:bg-chat-hover focus-visible:bg-chat-hover'
            }`}
          >
            {item.icon !== undefined && (
              <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center">
                {item.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Jeu d'icônes partagé par les menus (message, utilisateur, salon,     */
/* serveur) — mêmes tracés que les boutons existants (MessageActions,   */
/* ChatView, Sidebar) pour rester visuellement cohérent.                */
/* ------------------------------------------------------------------ */

export function CopyMenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 2a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h1v-2H8V4h8v1h2V4a2 2 0 0 0-2-2H8Zm4 6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-6Zm0 2h6v10h-6V10Z" />
    </svg>
  );
}

export function EditMenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.9 3.1a2.3 2.3 0 0 1 3.2 0l.8.8a2.3 2.3 0 0 1 0 3.2L9.6 18.4l-4.9 1.2a.6.6 0 0 1-.7-.7l1.2-4.9L16.9 3.1Zm1.4 1.4L6.6 16.2l-.7 2.7 2.7-.7L20.3 6.5a.3.3 0 0 0 0-.4l-.8-.8a.3.3 0 0 0-.4 0l-.8.2Z" />
    </svg>
  );
}

export function DeleteMenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7H4a1 1 0 0 1 0-2h4V4a1 1 0 0 1 1-1Zm-2 4v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7H7Zm3 3a1 1 0 0 1 2 0v7a1 1 0 1 1-2 0v-7Zm4-1a1 1 0 0 0-1 1v7a1 1 0 1 0 2 0v-7a1 1 0 0 0-1-1Z" />
    </svg>
  );
}

export function ReplyMenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10 8.3V4.9c0-.8-1-1.3-1.6-.7L1.7 10.3a1 1 0 0 0 0 1.5l6.7 6.1c.6.6 1.6.1 1.6-.7v-3.4c4.9 0 8.5 1.2 11 4.6-.1-6.1-3.3-9.6-11-10.1Z" />
    </svg>
  );
}

export function ForwardMenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14 8.3V4.9c0-.8 1-1.3 1.6-.7l6.7 6.1a1 1 0 0 1 0 1.5l-6.7 6.1c-.6.6-1.6.1-1.6-.7v-3.4c-4.9 0-8.5 1.2-11 4.6.1-6.1 3.3-9.6 11-10.1Z" />
    </svg>
  );
}

export function PinMenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14.6 2.6a1 1 0 0 1 1.4 0l5.4 5.4a1 1 0 0 1 0 1.4l-1.2 1.2a1 1 0 0 1-1 .3l-.7-.2-3.7 3.7.4 2.7a1 1 0 0 1-.3.9l-.9.9a1 1 0 0 1-1.4 0l-3.2-3.2-4.7 4.7a1 1 0 0 1-1.5-1.5l4.8-4.7-3.3-3.2a1 1 0 0 1 0-1.4l1-.9a1 1 0 0 1 .8-.3l2.7.4 3.7-3.7-.2-.7a1 1 0 0 1 .3-1l1.6-.8Z" />
    </svg>
  );
}

export function CheckMenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M9.5 16.6 4.9 12l-1.4 1.4L9.5 19.4 20.5 8.4l-1.4-1.4Z" />
    </svg>
  );
}

export function ProfileMenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2c0-2.8-3.6-5-8-5Z" />
    </svg>
  );
}

export function EnvelopeMenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9a2.5 2.5 0 0 1-2.5 2.5H9.4l-4 3a.9.9 0 0 1-1.4-.7V5.5Z" />
    </svg>
  );
}

export function GearMenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10.3 3.6a2 2 0 0 1 3.4 0l.6 1a2 2 0 0 0 2.2.9l1.1-.3a2 2 0 0 1 2.4 2.4l-.3 1.1a2 2 0 0 0 .9 2.2l1 .6a2 2 0 0 1 0 3.4l-1 .6a2 2 0 0 0-.9 2.2l.3 1.1a2 2 0 0 1-2.4 2.4l-1.1-.3a2 2 0 0 0-2.2.9l-.6 1a2 2 0 0 1-3.4 0l-.6-1a2 2 0 0 0-2.2-.9l-1.1.3a2 2 0 0 1-2.4-2.4l.3-1.1a2 2 0 0 0-.9-2.2l-1-.6a2 2 0 0 1 0-3.4l1-.6a2 2 0 0 0 .9-2.2l-.3-1.1a2 2 0 0 1 2.4-2.4l1.1.3a2 2 0 0 0 2.2-.9l.6-1ZM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
    </svg>
  );
}

export function LeaveMenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10 3a1 1 0 0 0-1 1v2a1 1 0 1 0 2 0V5h6v14h-6v-1a1 1 0 1 0-2 0v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-8Zm2.7 6.3a1 1 0 0 0-1.4 1.4L12.6 12l-1.3 1.3a1 1 0 1 0 1.4 1.4l2-2a1 1 0 0 0 0-1.4l-2-2ZM4 11a1 1 0 1 0 0 2h6v-2H4Z" />
    </svg>
  );
}

export function MentionMenuIcon() {
  return (
    <span aria-hidden className="text-xs font-bold leading-none">
      @
    </span>
  );
}
