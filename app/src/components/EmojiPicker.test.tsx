/**
 * Tests du sélecteur d'émojis : insertion d'un émoji Unicode et d'un émoji
 * custom du serveur courant, agrégation des customs de tous les serveurs
 * rejoints en MP (aucun serveur non rejoint ne fuite), recherche par
 * mots-clés et fermeture (Échap).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { GroupStateJson } from '../lib/api';
import { useGroups } from '../stores/groups';
import { useUi } from '../stores/ui';

vi.mock('../lib/files', () => ({
  lireFichier: vi.fn(() => Promise.resolve('blob:emoji')),
}));

import { EmojiPicker } from './EmojiPicker';
import { readRecents } from '../lib/emojiRecents';
import { useEmojiRecents } from '../stores/recents';

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
  // Récents isolés entre tests : stockage ET store partagé (module-level).
  window.localStorage.clear();
  useEmojiRecents.setState({ list: [] });
  // Par défaut sans émoji custom (aucune image asynchrone à charger) et
  // aucun serveur rejoint (l'agrégat MP ne doit rien voir fuiter).
  useGroups.setState({ ids: [], states: { g1: makeState({ emojis: [] }) } });
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

  it('n’agrège pas les émojis d’un serveur non rejoint (absent de `ids`) en MP', () => {
    // `g1` a un émoji custom mais ne figure pas dans `ids` (serveur non
    // rejoint, ou état mis en cache localement sans y appartenir).
    render(<EmojiPicker groupId={null} onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByText('Tes émojis personnalisés')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ':parrot:' })).not.toBeInTheDocument();
    // Les Unicode restent proposés.
    expect(screen.getByRole('button', { name: 'Insérer 👍' })).toBeInTheDocument();
  });

  it('agrège en MP les émojis custom de tous les serveurs rejoints', async () => {
    useGroups.setState({
      ids: ['g1', 'g2'],
      states: {
        g1: makeState({
          group_id: 'g1',
          emojis: [{ name: 'parrot', merkle_root: 'racine' }],
        }),
        g2: makeState({
          group_id: 'g2',
          emojis: [{ name: 'penguin', merkle_root: 'racine2' }],
        }),
      },
    });
    const onSelect = vi.fn();
    render(<EmojiPicker groupId={null} onSelect={onSelect} onClose={vi.fn()} />);

    expect(screen.getByText('Tes émojis personnalisés')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: ':penguin:' }));

    expect(onSelect).toHaveBeenCalledWith({
      kind: 'custom',
      name: 'penguin',
      merkleRoot: 'racine2',
    });
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

describe('EmojiPicker — récents', () => {
  it('n’affiche pas la section Récents quand la liste est vide', () => {
    render(<EmojiPicker groupId="g1" onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByText('Récents')).not.toBeInTheDocument();
  });

  it('affiche les émojis récents en tête et permet de les réinsérer', () => {
    useEmojiRecents.setState({ list: [{ kind: 'unicode', char: '🎉' }] });
    const onSelect = vi.fn();
    render(<EmojiPicker groupId="g1" onSelect={onSelect} onClose={vi.fn()} />);

    const recents = screen.getByRole('region', { name: 'Récents' });
    fireEvent.click(within(recents).getByRole('button', { name: 'Insérer 🎉' }));

    expect(onSelect).toHaveBeenCalledWith({ kind: 'unicode', char: '🎉' });
  });

  it('enregistre l’émoji choisi en tête des récents (persistance)', () => {
    render(<EmojiPicker groupId="g1" onSelect={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Insérer 👍' }));

    expect(readRecents()).toEqual([{ kind: 'unicode', char: '👍' }]);
  });

  it('filtre aussi les récents par la recherche', () => {
    useEmojiRecents.setState({ list: [{ kind: 'unicode', char: '🎉' }] });
    render(<EmojiPicker groupId="g1" onSelect={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Rechercher un émoji' }), {
      target: { value: 'chat' },
    });

    expect(screen.queryByText('Récents')).not.toBeInTheDocument();
  });
});

describe('EmojiPicker — focus', () => {
  it('rend le focus au déclencheur à la fermeture', () => {
    const { rerender } = render(<button type="button">Réagir</button>);
    const declencheur = screen.getByRole('button', { name: 'Réagir' });
    declencheur.focus();

    // Ouverture : le champ de recherche prend le focus (autoFocus)…
    rerender(
      <>
        <button type="button">Réagir</button>
        <EmojiPicker groupId="g1" onSelect={vi.fn()} onClose={vi.fn()} />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Rechercher un émoji' })).toHaveFocus();

    // …fermeture (démontage) : le déclencheur le récupère.
    rerender(<button type="button">Réagir</button>);
    expect(declencheur).toHaveFocus();
  });
});
