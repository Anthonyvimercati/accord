/** Tests du panneau des messages enregistrés : liste, retrait, saut, vide. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUi } from '../stores/ui';
import { useSaved, type SavedMessage } from '../stores/saved';
import { SavedMessages } from './SavedMessages';

const item = (msgId: string, text: string): SavedMessage => ({
  msgId,
  view: { kind: 'dm', peer: 'peer1' },
  author: 'peer1',
  text,
  ts: 1000,
  savedAt: 2000,
});

beforeEach(() => {
  window.localStorage.clear();
  useUi.setState({ lang: 'fr', jump: null });
  useSaved.setState({ items: [] });
});

describe('SavedMessages', () => {
  it('affiche l’état vide quand rien n’est enregistré', () => {
    render(<SavedMessages onClose={() => {}} />);
    expect(screen.getByText(/Aucun message enregistré/)).toBeInTheDocument();
  });

  it('liste les messages enregistrés', () => {
    useSaved.setState({ items: [item('m1', 'bonjour'), item('m2', 'salut')] });
    render(<SavedMessages onClose={() => {}} />);
    expect(screen.getByText('bonjour')).toBeInTheDocument();
    expect(screen.getByText('salut')).toBeInTheDocument();
  });

  it('retire un message via son bouton', async () => {
    useSaved.setState({ items: [item('m1', 'bonjour')] });
    render(<SavedMessages onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    expect(useSaved.getState().isSaved('m1')).toBe(false);
  });

  it('saute au message et ferme le panneau au clic', async () => {
    const onClose = vi.fn();
    useSaved.setState({ items: [item('m1', 'bonjour')] });
    render(<SavedMessages onClose={onClose} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Ouvrir le message enregistré' }),
    );
    expect(useUi.getState().jump?.msgId).toBe('m1');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
