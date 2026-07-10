/**
 * Tests du menu contextuel générique : rendu des items fournis par le
 * store, déclenchement de `onClick` (et fermeture), fermeture à Échap.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useContextMenu, type ContextMenuItem } from '../stores/contextMenu';
import { ContextMenu } from './ContextMenu';

function openWith(items: ContextMenuItem[]): void {
  useContextMenu.getState().openMenu(10, 20, items);
}

afterEach(() => {
  useContextMenu.setState({ menu: null });
});

describe('ContextMenu', () => {
  it('ne rend rien tant qu’aucun menu n’est ouvert', () => {
    render(<ContextMenu />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('rend les items fournis par le store, avec le style destructif sur `danger`', () => {
    openWith([
      { label: 'Copier le texte', onClick: vi.fn() },
      { label: 'Supprimer', onClick: vi.fn(), danger: true },
    ]);
    render(<ContextMenu />);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copier le texte' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Supprimer' })).toHaveClass('text-red');
  });

  it('déclenche `onClick` de l’item cliqué puis referme le menu', () => {
    const onClick = vi.fn();
    openWith([
      { label: 'Copier', onClick },
      { label: 'Autre', onClick: vi.fn() },
    ]);
    render(<ContextMenu />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copier' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(useContextMenu.getState().menu).toBeNull();
  });

  it('se ferme à Échap sans déclencher d’item', () => {
    const onClick = vi.fn();
    openWith([{ label: 'Copier', onClick }]);
    render(<ContextMenu />);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(onClick).not.toHaveBeenCalled();
    expect(useContextMenu.getState().menu).toBeNull();
  });
});
