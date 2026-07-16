/**
 * Tests du sélecteur de transfert : liste des amis (MP) et des salons texte
 * (les salons vocaux sont exclus), et re-envoi du texte + pièces jointes vers
 * la destination choisie.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../lib/client', () => ({
  rpc: { onEvent: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) },
  api: {},
}));

import type { Contact, GroupStateJson } from '../lib/api';
import { useDms } from '../stores/dms';
import { useFriends } from '../stores/friends';
import { useGroups } from '../stores/groups';
import { useUi } from '../stores/ui';
import { ForwardPicker } from './ForwardPicker';

const dmSend = vi.fn(() => Promise.resolve());
const groupSend = vi.fn(() => Promise.resolve());

function groupWithChannels(): GroupStateJson {
  return {
    group_id: 'g1',
    name: 'Gaming',
    icon: null,
    founder: null,
    members: [],
    bans: [],
    channels: [
      {
        channel_id: 'c1',
        name: 'general',
        kind: 'text',
        category: null,
        position: 0,
        topic: '',
      },
      {
        channel_id: 'v1',
        name: 'Voix',
        kind: 'voice',
        category: null,
        position: 1,
        topic: '',
      },
    ],
    categories: [],
    roles: [],
    invites: [],
    my_permissions: 0,
  };
}

beforeEach(() => {
  useUi.setState({ lang: 'fr' });
  useFriends.setState({
    contacts: [
      { pubkey: 'pk_bob', display_name: 'Bob', state: 'friend' },
    ] as unknown as Contact[],
  });
  useGroups.setState({ ids: ['g1'], states: { g1: groupWithChannels() } });
  useDms.setState({
    send: dmSend as unknown as ReturnType<typeof useDms.getState>['send'],
  });
  useGroups.setState({
    send: groupSend as unknown as ReturnType<typeof useGroups.getState>['send'],
  });
  dmSend.mockClear();
  groupSend.mockClear();
});

describe('ForwardPicker', () => {
  it('liste les amis et les salons texte, sans les salons vocaux', () => {
    render(<ForwardPicker text="hello" onClose={vi.fn()} />);

    expect(screen.getByText('@Bob')).toBeInTheDocument();
    expect(screen.getByText('#general')).toBeInTheDocument();
    expect(screen.queryByText('#Voix')).not.toBeInTheDocument();
  });

  it('transfère vers un ami (dm.send) puis se ferme', () => {
    const onClose = vi.fn();
    render(<ForwardPicker text="hello" onClose={onClose} />);

    fireEvent.click(screen.getByText('@Bob'));

    expect(dmSend).toHaveBeenCalledWith('pk_bob', 'hello', undefined, undefined);
  });

  it('transfère le texte et les pièces jointes vers un salon', () => {
    const attachment = {
      merkle_root: 'ab'.repeat(32),
      name: 'f.png',
      size: 1,
      mime: 'image/png',
    };
    render(<ForwardPicker text="" attachments={[attachment]} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('#general'));

    expect(groupSend).toHaveBeenCalledWith('g1', 'c1', '', undefined, [attachment]);
  });

  it('affiche l’état vide sans destination', () => {
    useFriends.setState({ contacts: [] });
    useGroups.setState({ ids: [], states: {} });
    render(<ForwardPicker text="hello" onClose={vi.fn()} />);

    expect(screen.getByText('Aucune destination disponible.')).toBeInTheDocument();
  });
});
