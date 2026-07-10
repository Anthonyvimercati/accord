/**
 * Session store tests, focused on the logout (lock) transition: the store
 * must land on the unlock screen exactly like a fresh launch on an existing
 * vault, survive the RPC link closing underneath it, and allow an immediate
 * re-unlock afterwards.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../lib/client', () => ({
  rpc: {
    onStatus: vi.fn(),
    connect: vi.fn(async () => {}),
    close: vi.fn(),
  },
  api: {
    identitySelf: vi.fn(),
    profileSet: vi.fn(),
    profileSetAvatar: vi.fn(),
    profileSetBanner: vi.fn(),
  },
}));

vi.mock('../lib/bridge', () => ({
  vaultStatus: vi.fn(),
  createIdentity: vi.fn(),
  restoreIdentity: vi.fn(),
  unlockIdentity: vi.fn(),
  lockIdentity: vi.fn(),
}));

import { api, rpc } from '../lib/client';
import type { SelfProfile } from '../lib/api';
import { lockIdentity, unlockIdentity } from '../lib/bridge';
import {
  rememberNotifiedConversation,
  takePendingConversation,
} from '../lib/notifications';
import { useSession } from './session';

const lockIdentityMock = lockIdentity as unknown as Mock;
const unlockIdentityMock = unlockIdentity as unknown as Mock;
const identitySelfMock = api.identitySelf as unknown as Mock;
const closeMock = rpc.close as unknown as Mock;
const connectMock = rpc.connect as unknown as Mock;

const self: SelfProfile = {
  node_id: 'n-moi',
  pubkey: 'aa'.repeat(32),
  friend_code: 'accord-moi-12345',
  name: 'Alex',
  bio: null,
  avatar: null,
  banner: null,
};

/**
 * RPC status callback registered once at store creation — captured before
 * `vi.clearAllMocks()` wipes the recorded call.
 */
const statusCallback = (rpc.onStatus as unknown as Mock).mock
  .calls[0]?.[0] as (status: string) => void;

beforeEach(() => {
  vi.clearAllMocks();
  lockIdentityMock.mockResolvedValue('locked');
  useSession.setState({
    phase: 'ready',
    self,
    recoveryPhrase: null,
    askName: false,
    error: null,
  });
});

describe('useSession.lock', () => {
  it('lands on the unlock screen with the session state wiped', async () => {
    useSession.setState({ recoveryPhrase: 'douze mots', askName: true, error: 'old' });

    await useSession.getState().lock();

    const s = useSession.getState();
    expect(s.phase).toBe('locked');
    expect(s.self).toBeNull();
    expect(s.recoveryPhrase).toBeNull();
    expect(s.askName).toBe(false);
    expect(s.error).toBeNull();
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(lockIdentityMock).toHaveBeenCalledTimes(1);
  });

  it('drops any pending notification navigation', async () => {
    rememberNotifiedConversation({ kind: 'dm', peer: 'pair-1' });

    await useSession.getState().lock();

    expect(takePendingConversation()).toBeNull();
  });

  it('ignores the RPC link closing after logout (no offline bounce)', async () => {
    await useSession.getState().lock();

    statusCallback('closed');

    expect(useSession.getState().phase).toBe('locked');
  });

  it('falls back to onboarding when the vault file disappeared', async () => {
    lockIdentityMock.mockResolvedValue('absent');

    await useSession.getState().lock();

    expect(useSession.getState().phase).toBe('setup');
  });

  it('stays on the unlock screen with the error surfaced when locking fails', async () => {
    lockIdentityMock.mockRejectedValue(new Error('boom'));

    await useSession.getState().lock();

    const s = useSession.getState();
    expect(s.phase).toBe('locked');
    expect(s.error).toBe('boom');
  });

  it('allows an immediate re-unlock, exactly like a fresh launch', async () => {
    unlockIdentityMock.mockResolvedValue({ port: 4242, token: 'jeton' });
    identitySelfMock.mockResolvedValue(self);

    await useSession.getState().lock();
    await useSession.getState().unlock('phrase-de-passe');

    const s = useSession.getState();
    expect(s.phase).toBe('ready');
    expect(s.self).toEqual(self);
    expect(s.askName).toBe(false);
    expect(connectMock).toHaveBeenCalledWith(4242, 'jeton');
  });
});
