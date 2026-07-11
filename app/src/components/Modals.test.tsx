/**
 * Tests de la modale d'invitation de serveur (consentement explicite, D-045) :
 * seuls les amis non-membres sont proposés, et le clic appelle bien
 * `groups.invite_create` — jamais l'ancien force-join (`groups.invite`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../lib/client', () => ({
  rpc: {
    call: vi.fn(() => Promise.resolve({ messages: [] })),
    onEvent: vi.fn(() => () => {}),
    onStatus: vi.fn(() => () => {}),
  },
  api: {
    groupsInviteCreate: vi.fn(() => Promise.resolve({ invite_id: 'i1' })),
    groupsState: vi.fn(() => Promise.resolve(groupStateFixture())),
    groupsSendPoll: vi.fn(() => Promise.resolve({ msg_id: 'm1', poll_id: 'p1' })),
  },
}));

import { api } from '../lib/client';
import type { Contact, GroupStateJson } from '../lib/api';
import { useFriends } from '../stores/friends';
import { useGroups } from '../stores/groups';
import { useUi } from '../stores/ui';
import { Modals } from './Modals';

function groupStateFixture(members: GroupStateJson['members'] = []): GroupStateJson {
  return {
    group_id: 'g1',
    name: 'Guilde',
    icon: null,
    founder: null,
    members,
    bans: [],
    channels: [],
    categories: [],
    roles: [],
    invites: [],
    my_permissions: 0,
  };
}

describe('InviteModal (Modals.tsx) — invitation par consentement (D-045)', () => {
  beforeEach(() => {
    useUi.setState({ lang: 'fr', modal: { kind: 'invite', groupId: 'g1' } });
    useFriends.setState({
      contacts: [
        { pubkey: 'pk_bob', display_name: 'Bob', state: 'friend' },
        { pubkey: 'pk_membre', display_name: 'Déjà membre', state: 'friend' },
      ] as unknown as Contact[],
    });
    useGroups.setState({
      states: { g1: groupStateFixture([{ pubkey: 'pk_membre', roles: [] }]) },
    });
    (api.groupsInviteCreate as unknown as ReturnType<typeof vi.fn>).mockClear();
    (api.groupsState as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('propose seulement les amis qui ne sont pas déjà membres', () => {
    render(<Modals />);

    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Déjà membre')).not.toBeInTheDocument();
  });

  it('appelle groups.invite_create au clic — jamais l’ancien force-join', async () => {
    render(<Modals />);

    fireEvent.click(screen.getByRole('button', { name: 'Inviter' }));

    await vi.waitFor(() =>
      expect(api.groupsInviteCreate).toHaveBeenCalledWith('g1', 'pk_bob'),
    );
  });
});

describe('CreatePollModal (Modals.tsx) — création de sondage (D-048)', () => {
  beforeEach(() => {
    useUi.setState({
      lang: 'fr',
      modal: { kind: 'createPoll', groupId: 'g1', channelId: 'c1' },
    });
    useGroups.setState({ states: { g1: groupStateFixture() } });
    (api.groupsSendPoll as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  function fillOption(index: number, value: string): void {
    fireEvent.change(screen.getByPlaceholderText(`Option ${index}`), {
      target: { value },
    });
  }

  it('démarre avec 2 options et Créer désactivé (question et options vides)', () => {
    render(<Modals />);

    expect(screen.getByPlaceholderText('Option 1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Option 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer le sondage' })).toBeDisabled();
  });

  it('reste désactivé avec une seule option renseignée', () => {
    render(<Modals />);
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'Pizza ou sushis ?' },
    });
    fillOption(1, 'Pizza');

    expect(screen.getByRole('button', { name: 'Créer le sondage' })).toBeDisabled();
  });

  it('s’active une fois la question et 2 options valides renseignées, puis crée le sondage', async () => {
    render(<Modals />);
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'Pizza ou sushis ?' },
    });
    fillOption(1, 'Pizza');
    fillOption(2, 'Sushis');

    const createButton = screen.getByRole('button', { name: 'Créer le sondage' });
    expect(createButton).toBeEnabled();
    fireEvent.click(createButton);

    await vi.waitFor(() =>
      expect(api.groupsSendPoll).toHaveBeenCalledWith('g1', 'c1', 'Pizza ou sushis ?', [
        'Pizza',
        'Sushis',
      ]),
    );
  });

  it('permet d’ajouter des options jusqu’à 10, puis masque « Ajouter une option »', () => {
    render(<Modals />);
    const addButton = screen.getByRole('button', { name: /Ajouter une option/ });

    for (let i = 0; i < 8; i += 1) fireEvent.click(addButton);

    expect(screen.getByPlaceholderText('Option 10')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Ajouter une option/ }),
    ).not.toBeInTheDocument();
  });

  it('ne permet pas de retirer une option sous 2 (bouton de retrait absent à 2 options)', () => {
    render(<Modals />);

    expect(screen.queryByLabelText(/Retirer l.option/)).not.toBeInTheDocument();
  });

  it('retirer une option au-delà de 2 fait disparaître sa rangée', () => {
    render(<Modals />);
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une option/ }));
    expect(screen.getByPlaceholderText('Option 3')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Retirer l’option 3'));

    expect(screen.queryByPlaceholderText('Option 3')).not.toBeInTheDocument();
  });

  it('reste désactivé au-delà de la borne de question (300 octets UTF-8)', () => {
    render(<Modals />);
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'a'.repeat(301) },
    });
    fillOption(1, 'Pizza');
    fillOption(2, 'Sushis');

    expect(screen.getByRole('button', { name: 'Créer le sondage' })).toBeDisabled();
  });

  it('désactive Créer et affiche l’indication au plafond de 25 sondages par groupe', () => {
    const polls = Array.from({ length: 25 }, (_, i) => ({
      poll_id: `p${i}`,
      author: 'moi',
      closed: false,
      counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      total_votes: 0,
      my_vote: null,
    }));
    useGroups.setState({ states: { g1: { ...groupStateFixture(), polls } } });
    render(<Modals />);
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'Pizza ou sushis ?' },
    });
    fillOption(1, 'Pizza');
    fillOption(2, 'Sushis');

    expect(screen.getByText('25 sondages au maximum par groupe.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer le sondage' })).toBeDisabled();
  });
});
