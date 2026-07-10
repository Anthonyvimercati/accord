/**
 * Tests du sélecteur d'émojis : insertion d'un émoji Unicode et d'un émoji
 * custom du serveur courant, absence des customs en MP, recherche par mots-clés
 * et fermeture (Échap).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { GroupStateJson } from '../lib/api';
import { useGroups } from '../stores/groups';
import { useUi } from '../stores/ui';

vi.mock('../lib/files', () => ({
  lireFichier: vi.fn(() => Promise.resolve('blob:emoji')),
}));

import { EmojiPicker } from './EmojiPicker';

function makeState(over: Partial<GroupStateJson> = {}): GroupStateJson {
  return {
    group_id: 'g1',
    name: 'Guilde',
    icon: null,
    founder: 'f',
    members: [],
    bans: [],
    channels: [],
    categories: [],
    roles: [],
    invites: [],
    emojis: [{ name: 'parrot', merkle_root: 'racine' }],
    my_permissions: 0x1ff,
    ...over,
  };
}

beforeEach(() => {
  useUi.setState({ lang: 'fr' });
  // Par défaut sans émoji custom (aucune image asynchrone à charger).
  useGroups.setState({ states: { g1: makeState({ emojis: [] }) } });
});

describe('EmojiPicker — insertion', () => {
  it('insère un émoji Unicode', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker groupId="g1" onSelect={onSelect} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Insérer 👍' }));

    expect(onSelect).toHaveBeenCalledWith({ kind: 'unicode', char: '👍' });
  });

  it('insère un émoji custom du serveur courant', async () => {
    useGroups.setState({ states: { g1: makeState() } });
    const onSelect = vi.fn();
    render(<EmojiPicker groupId="g1" onSelect={onSelect} onClose={vi.fn()} />);

    // Attend le chargement de l'image de l'émoji custom (flush des états).
    fireEvent.click(await screen.findByRole('button', { name: ':parrot:' }));

    expect(onSelect).toHaveBeenCalledWith({
      kind: 'custom',
      name: 'parrot',
      merkleRoot: 'racine',
    });
  });

  it('n’expose aucun émoji custom en MP (sans serveur)', () => {
    render(<EmojiPicker groupId={null} onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByText('Émojis du serveur')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ':parrot:' })).not.toBeInTheDocument();
    // Les Unicode restent proposés.
    expect(screen.getByRole('button', { name: 'Insérer 👍' })).toBeInTheDocument();
  });
});

describe('EmojiPicker — recherche et fermeture', () => {
  it('filtre les émojis par mot-clé', () => {
    render(<EmojiPicker groupId="g1" onSelect={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Rechercher un émoji' }), {
      target: { value: 'chat' },
    });

    expect(screen.getByRole('button', { name: 'Insérer 🐱' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Insérer 👍' })).not.toBeInTheDocument();
  });

  it('se ferme avec Échap', () => {
    const onClose = vi.fn();
    render(<EmojiPicker groupId="g1" onSelect={vi.fn()} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});
