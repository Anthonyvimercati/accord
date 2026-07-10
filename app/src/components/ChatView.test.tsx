/**
 * Tests de la vue conversation privée : marquage lu (dm.mark_read) au
 * lamport du dernier message affiché à l'ouverture puis à chaque arrivée,
 * aucun marquage sur fil vide, et indicateur de frappe du pair.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

vi.mock('../lib/client', () => ({
  rpc: { call: vi.fn(), onEvent: vi.fn(() => () => {}), onStatus: vi.fn() },
  api: {
    dmMarkRead: vi.fn(),
    friendsList: vi.fn(),
    filesShareBytes: vi.fn(),
  },
}));

import { api, rpc } from '../lib/client';
import type { Contact, DmMessage } from '../lib/api';
import { useDms } from '../stores/dms';
import { useFriends } from '../stores/friends';
import { useTyping, dmTypingKey, TYPING_EXPIRY_MS } from '../stores/typing';
import { useUi } from '../stores/ui';
import { DmView } from './ChatView';

const callMock = rpc.call as unknown as Mock;
const markReadMock = api.dmMarkRead as unknown as Mock;
const friendsListMock = api.friendsList as unknown as Mock;

const PEER = 'pair-pk';

function contact(pubkey: string, displayName: string): Contact {
  return {
    node_id: 'noeud',
    pubkey,
    friend_code: 'accord-lion-foret-12345',
    display_name: displayName,
    bio: null,
    avatar: null,
    banner: null,
    state: 'friend',
    last_seen_ms: 0,
  };
}

function dmMsg(id: string, lamport: number): DmMessage {
  return {
    msg_id: id,
    author: PEER,
    lamport,
    sent_ms: lamport * 1000,
    acked: true,
    deleted: false,
    body: { type: 'text', text: `message ${id}`, reply_to: null, attachments: 0 },
    edited: null,
  };
}

beforeEach(() => {
  useUi.setState({ lang: 'fr', view: { kind: 'dm', peer: PEER }, toasts: [] });
  useDms.setState({ conversations: {}, hasMore: {}, loadingOlder: {} });
  useFriends.setState({ contacts: [contact(PEER, 'Alice')], loaded: false });
  useTyping.setState({ writers: {} });
  callMock.mockReset();
  markReadMock.mockReset();
  friendsListMock.mockReset();
  markReadMock.mockResolvedValue({ ok: true });
  friendsListMock.mockResolvedValue({ contacts: [contact(PEER, 'Alice')] });
});

describe('DmView — marquage lu', () => {
  it('marque la conversation lue au lamport du dernier message affiché', async () => {
    // Arrange : la page récente contient deux messages (lamports 5 et 7).
    callMock.mockResolvedValue({ messages: [dmMsg('b', 7), dmMsg('a', 5)] });

    // Act
    render(<DmView peer={PEER} />);

    // Assert : mark_read au dernier lamport, puis liste d'amis rafraîchie
    // (le compteur de non-lus retombe).
    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith(PEER, 7));
    await waitFor(() => expect(useFriends.getState().loaded).toBe(true));
    expect(friendsListMock).toHaveBeenCalled();
  });

  it('ne marque rien tant que le fil est vide', async () => {
    // Arrange
    callMock.mockResolvedValue({ messages: [] });

    // Act
    render(<DmView peer={PEER} />);

    // Assert
    await waitFor(() => expect(callMock).toHaveBeenCalled());
    expect(markReadMock).not.toHaveBeenCalled();
  });

  it('marque à nouveau quand un message arrive dans la conversation ouverte', async () => {
    // Arrange
    callMock.mockResolvedValue({ messages: [dmMsg('a', 5)] });
    render(<DmView peer={PEER} />);
    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith(PEER, 5));

    // Act : un événement rafraîchit le fil avec un message plus récent.
    callMock.mockResolvedValue({ messages: [dmMsg('b', 9), dmMsg('a', 5)] });
    await act(async () => {
      await useDms.getState().refresh(PEER);
    });

    // Assert
    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith(PEER, 9));
  });
});

describe('DmView — indicateur de frappe', () => {
  it("affiche l'indicateur du pair sous la zone de saisie", async () => {
    // Arrange
    callMock.mockResolvedValue({ messages: [] });
    useTyping.setState({
      writers: { [dmTypingKey(PEER)]: { [PEER]: Date.now() + TYPING_EXPIRY_MS } },
    });

    // Act
    render(<DmView peer={PEER} />);

    // Assert
    expect(screen.getByText('Alice est en train d’écrire…')).toBeInTheDocument();
    await waitFor(() => expect(callMock).toHaveBeenCalled());
  });
});
