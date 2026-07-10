/**
 * Tests des réactions : agrégation des paires emoji × auteur en pastilles
 * (compte, ordre stable, marquage « ma réaction ») et rangée cliquable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Reaction } from '../lib/api';
import { useUi } from '../stores/ui';
import { aggregateReactions, ReactionRow } from './Reactions';

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
