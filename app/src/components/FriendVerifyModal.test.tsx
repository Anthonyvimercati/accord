/**
 * Identity-verification modal tests: safety number rendering (12 groups of
 * 5 digits + 8 emoji), verified toggle round-trip, broken-verification
 * warning, and closing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../lib/client', () => ({
  rpc: { onEvent: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) },
  api: {
    friendsSafetyNumber: vi.fn(),
    friendsSetVerified: vi.fn(() => Promise.resolve({ ok: true })),
    friendsList: vi.fn(() => Promise.resolve({ contacts: [] })),
  },
}));

import { api } from '../lib/client';
import type { Contact } from '../lib/api';
import { useFriends } from '../stores/friends';
import { useUi } from '../stores/ui';
import { FriendVerifyModal } from './FriendVerifyModal';

const numberMock = api.friendsSafetyNumber as unknown as Mock;
const setVerifiedMock = api.friendsSetVerified as unknown as Mock;

const DIGITS = '123450987612345098761234509876123450987612345098761234509876';
const EMOJI = ['🐶', '🐱', '🦊', '🐼', '🦉', '🐙', '🍀', '🌊'];

const AMI: Contact = {
  node_id: 'na',
  pubkey: 'ami-pk',
  friend_code: 'accord-ami',
  display_name: 'Alice',
  bio: null,
  avatar: null,
  banner: null,
  state: 'friend',
  last_seen_ms: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ lang: 'fr', verifyTarget: null });
  useFriends.setState({ contacts: [AMI] });
  numberMock.mockResolvedValue({
    digits: DIGITS,
    emoji: EMOJI,
    verified: false,
    key_changed: false,
  });
});

describe('FriendVerifyModal', () => {
  it('renders nothing without a target', () => {
    render(<FriendVerifyModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the number as 12 groups of 5 digits plus 8 emoji', async () => {
    useUi.setState({ verifyTarget: 'ami-pk' });
    render(<FriendVerifyModal />);

    expect(await screen.findAllByText('12345')).toHaveLength(6);
    expect(screen.getAllByText('09876')).toHaveLength(6);
    expect(screen.getByText('🐙')).toBeInTheDocument();
    expect(numberMock).toHaveBeenCalledWith('ami-pk');
    expect(
      screen.getByRole('button', { name: 'Marquer comme vérifié' }),
    ).toBeInTheDocument();
  });

  it('marks the contact verified and reloads the friends list', async () => {
    useUi.setState({ verifyTarget: 'ami-pk' });
    render(<FriendVerifyModal />);

    fireEvent.click(await screen.findByRole('button', { name: 'Marquer comme vérifié' }));

    await waitFor(() => {
      expect(setVerifiedMock).toHaveBeenCalledWith('ami-pk', true);
    });
    expect(
      await screen.findByRole('button', { name: 'Retirer la vérification' }),
    ).toBeInTheDocument();
    expect(api.friendsList).toHaveBeenCalled();
  });

  it('warns when the key changed since verification', async () => {
    numberMock.mockResolvedValue({
      digits: DIGITS,
      emoji: EMOJI,
      verified: true,
      key_changed: true,
    });
    useUi.setState({ verifyTarget: 'ami-pk' });
    render(<FriendVerifyModal />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La clé de ce contact a changé',
    );
  });

  it('closes on Escape', async () => {
    useUi.setState({ verifyTarget: 'ami-pk' });
    render(<FriendVerifyModal />);
    await screen.findAllByText('12345');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useUi.getState().verifyTarget).toBeNull();
  });
});
