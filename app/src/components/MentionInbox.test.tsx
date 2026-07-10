/**
 * Tests de la boîte de mentions : chargement de `mentions.inbox`, état vide,
 * saut vers le message au clic (marque l'entrée lue + demande de saut) et
 * « tout marquer comme lu ».
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../lib/client', () => ({
  rpc: { onEvent: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) },
  api: {
    mentionsInbox: vi.fn(),
    mentionsMarkRead: vi.fn(() => Promise.resolve({ ok: true, marked: 0 })),
    friendsList: vi.fn(() => Promise.resolve({ contacts: [] })),
    groupsList: vi.fn(() => Promise.resolve({ groups: [] })),
  },
}));

import { api } from '../lib/client';
import type { Contact, MentionEntry } from '../lib/api';
import { useFriends } from '../stores/friends';
import { useUi } from '../stores/ui';
import { MentionInbox } from './MentionInbox';

const inboxMock = api.mentionsInbox as unknown as Mock;
const markReadMock = api.mentionsMarkRead as unknown as Mock;

const DM_ENTRY: MentionEntry = {
  msg_id: 'm1',
  conversation: { kind: 'dm', peer: 'pk_bob' },
  author: 'pk_bob',
  ts_ms: 1_700_000_000_000,
  lamport: 5,
  snippet: 'salut @moi',
  read: false,
};

beforeEach(() => {
  useUi.setState({ lang: 'fr', jump: null, view: { kind: 'friends' } });
  useFriends.setState({
    contacts: [{ pubkey: 'pk_bob', display_name: 'Bob' }] as unknown as Contact[],
  });
  inboxMock.mockReset();
  markReadMock.mockClear();
});

describe('MentionInbox', () => {
  it('charge et affiche les mentions récentes', async () => {
    inboxMock.mockResolvedValueOnce({ entries: [DM_ENTRY] });
    render(<MentionInbox onClose={vi.fn()} />);

    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('salut @moi')).toBeInTheDocument();
  });

  it('affiche l’état vide sans mention', async () => {
    inboxMock.mockResolvedValueOnce({ entries: [] });
    render(<MentionInbox onClose={vi.fn()} />);

    expect(await screen.findByText('Aucune mention récente.')).toBeInTheDocument();
  });

  it('saute au message au clic et marque l’entrée lue', async () => {
    inboxMock.mockResolvedValueOnce({ entries: [DM_ENTRY] });
    const onClose = vi.fn();
    render(<MentionInbox onClose={onClose} />);

    fireEvent.click(await screen.findByRole('button', { name: /salut @moi/ }));

    expect(markReadMock).toHaveBeenCalledWith(['m1']);
    expect(useUi.getState().jump).toMatchObject({
      view: { kind: 'dm', peer: 'pk_bob' },
      msgId: 'm1',
    });
    expect(onClose).toHaveBeenCalled();
    // Laisse le rafraîchissement des pastilles se dérouler (évite un act()).
    await waitFor(() => expect(api.friendsList).toHaveBeenCalled());
  });

  it('marque toutes les mentions comme lues', async () => {
    inboxMock.mockResolvedValueOnce({ entries: [DM_ENTRY] });
    render(<MentionInbox onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Tout marquer comme lu'));

    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith());
  });
});
