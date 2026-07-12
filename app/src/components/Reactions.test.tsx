/**
 * Tests des réactions : agrégation des paires emoji × auteur en pastilles
 * (compte, ordre stable, marquage « ma réaction ») et rangée cliquable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Reaction } from '../lib/api';
import { useUi } from '../stores/ui';
import { aggregateReactions, reactorsOf, ReactionRow } from './Reactions';

beforeEach(() => {
  useUi.setState({ lang: 'fr' });
});

describe('aggregateReactions', () => {
  it('regroupe par emoji avec le compte, dans l’ordre de première apparition', () => {
    const reactions: Reaction[] = [
      { emoji: '👍', author: 'alice' },
      { emoji: '❤️', author: 'bob' },
      { emoji: '👍', author: 'bob' },
    ];

    expect(aggregateReactions(reactions, null)).toEqual([
      { emoji: '👍', count: 2, mine: false },
      { emoji: '❤️', count: 1, mine: false },
    ]);
  });

  it('marque la pastille quand l’utilisateur a réagi', () => {
    const reactions: Reaction[] = [
      { emoji: '👍', author: 'alice' },
      { emoji: '👍', author: 'moi' },
      { emoji: '❤️', author: 'alice' },
    ];

    const pills = aggregateReactions(reactions, 'moi');

    expect(pills).toEqual([
      { emoji: '👍', count: 2, mine: true },
      { emoji: '❤️', count: 1, mine: false },
    ]);
  });

  it('rend une liste vide sans réaction (absente ou vide)', () => {
    expect(aggregateReactions(undefined, 'moi')).toEqual([]);
    expect(aggregateReactions([], 'moi')).toEqual([]);
  });
});

describe('ReactionRow', () => {
  const reactions: Reaction[] = [
    { emoji: '👍', author: 'moi' },
    { emoji: '👍', author: 'alice' },
    { emoji: '🎉', author: 'alice' },
  ];

  it('affiche une pastille par emoji avec son compte', () => {
    render(<ReactionRow reactions={reactions} selfPubkey="moi" />);

    const thumb = screen.getByRole('button', { name: 'Réagir avec 👍' });
    const party = screen.getByRole('button', { name: 'Réagir avec 🎉' });
    expect(thumb).toHaveTextContent('2');
    expect(party).toHaveTextContent('1');
  });

  it('surligne (aria-pressed) uniquement les pastilles de l’utilisateur', () => {
    render(<ReactionRow reactions={reactions} selfPubkey="moi" />);

    expect(screen.getByRole('button', { name: 'Réagir avec 👍' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Réagir avec 🎉' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('bascule la réaction au clic', () => {
    const onToggle = vi.fn();
    render(<ReactionRow reactions={reactions} selfPubkey="moi" onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: 'Réagir avec 🎉' }));

    expect(onToggle).toHaveBeenCalledWith('🎉');
  });

  it('ne rend rien sans réaction', () => {
    const { container } = render(<ReactionRow reactions={[]} selfPubkey="moi" />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('reactorsOf', () => {
  const reactions: Reaction[] = [
    { emoji: '👍', author: 'alice' },
    { emoji: '❤️', author: 'bob' },
    { emoji: '👍', author: 'moi' },
    { emoji: '👍', author: 'alice' },
  ];

  it('liste les auteurs d’un emoji, dédupliqués et dans l’ordre', () => {
    expect(reactorsOf(reactions, '👍')).toEqual(['alice', 'moi']);
  });

  it('rend une liste vide pour un emoji absent ou sans réactions', () => {
    expect(reactorsOf(reactions, '🎉')).toEqual([]);
    expect(reactorsOf(undefined, '👍')).toEqual([]);
  });
});

describe('ReactionRow — popover « qui a réagi »', () => {
  const reactions: Reaction[] = [
    { emoji: '👍', author: 'alice' },
    { emoji: '👍', author: 'moi' },
  ];
  const nameOf = (pubkey: string): string => (pubkey === 'moi' ? 'Moi' : 'Alice');

  it('ouvre au clic droit un popover listant les auteurs résolus', () => {
    render(<ReactionRow reactions={reactions} selfPubkey="moi" nameOf={nameOf} />);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Réagir avec 👍' }));

    const dialog = screen.getByRole('dialog', { name: 'Ont réagi avec 👍' });
    expect(within(dialog).getByText('Alice')).toBeInTheDocument();
    expect(within(dialog).getByText('Moi')).toBeInTheDocument();
  });

  it('ne bascule pas la réaction au clic droit', () => {
    const onToggle = vi.fn();
    render(
      <ReactionRow
        reactions={reactions}
        selfPubkey="moi"
        nameOf={nameOf}
        onToggle={onToggle}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Réagir avec 👍' }));

    expect(onToggle).not.toHaveBeenCalled();
  });

  it('se ferme avec Échap', () => {
    render(<ReactionRow reactions={reactions} selfPubkey="moi" nameOf={nameOf} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Réagir avec 👍' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('se ferme au clic extérieur', () => {
    render(<ReactionRow reactions={reactions} selfPubkey="moi" nameOf={nameOf} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Réagir avec 👍' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ouvre le profil de l’auteur cliqué dans le popover', () => {
    const onOpenAuthor = vi.fn();
    render(
      <ReactionRow
        reactions={reactions}
        selfPubkey="moi"
        nameOf={nameOf}
        onOpenAuthor={onOpenAuthor}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Réagir avec 👍' }));

    fireEvent.click(within(screen.getByRole('dialog')).getByText('Alice'));

    expect(onOpenAuthor).toHaveBeenCalledWith('alice', expect.any(HTMLElement));
  });
});
