/**
 * Tests de la section « Salons vocaux » : entrée du salon par défaut, jonction
 * au clic (convention channel_id == group_id) et rendu des participants avec
 * anneau vert autour de l'avatar de la personne qui parle.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Contact, SelfProfile } from '../lib/api';
import { useFriends } from '../stores/friends';
import { useSession } from '../stores/session';
import { useUi } from '../stores/ui';
import { useVoice } from '../stores/voice';
import { VoiceSection } from './VoiceSection';

const self: SelfProfile = {
  node_id: 'n-moi',
  pubkey: 'moi',
  friend_code: 'accord-moi',
  name: null,
  bio: null,
  avatar: null,
  banner: null,
};

const alice: Contact = {
  node_id: 'n-alice',
  pubkey: 'alice',
  friend_code: 'accord-alice',
  display_name: 'Alice',
  bio: null,
  avatar: null,
  banner: null,
  state: 'friend',
  last_seen_ms: 0,
};

/** Connecte le salon vocal du groupe donné avec ces participants. */
function seedVoice(groupId: string, participants: Array<[string, boolean]>): void {
  useVoice.setState({
    active: { groupId, channelId: groupId, muted: false },
    participants: new Map(participants.map(([pk, speaking]) => [pk, { speaking }])),
  });
}

beforeEach(() => {
  useUi.setState({ lang: 'fr', toasts: [] });
  useSession.setState({ self, phase: 'ready' });
  useFriends.setState({ contacts: [alice] });
  useVoice.setState({ active: null, participants: new Map() });
});

describe('VoiceSection', () => {
  it('affiche la section et l’entrée du salon vocal par défaut', () => {
    render(<VoiceSection groupId="g1" />);

    expect(screen.getByText('Salons vocaux')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salon vocal' })).toBeInTheDocument();
  });

  it('rejoint au clic avec channel_id == group_id (convention UI)', () => {
    const join = vi.fn(async (_groupId: string, _channelId: string) => {});
    useVoice.setState({ join });
    render(<VoiceSection groupId="g1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Salon vocal' }));

    expect(join).toHaveBeenCalledWith('g1', 'g1');
  });

  it('ne rejoint pas de nouveau quand on est déjà dans ce salon', () => {
    const join = vi.fn(async (_groupId: string, _channelId: string) => {});
    seedVoice('g1', [['moi', false]]);
    useVoice.setState({ join });
    render(<VoiceSection groupId="g1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Salon vocal' }));

    expect(join).not.toHaveBeenCalled();
  });

  it('signale l’échec de jonction par un toast d’erreur', async () => {
    useVoice.setState({
      join: vi.fn(async () => {
        throw new Error('salon plein');
      }),
    });
    render(<VoiceSection groupId="g1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Salon vocal' }));

    await waitFor(() => {
      expect(useUi.getState().toasts).toHaveLength(1);
    });
    expect(useUi.getState().toasts[0]?.kind).toBe('error');
  });

  it('liste les participants connectés (pseudo du contact, code ami pour soi)', () => {
    seedVoice('g1', [
      ['moi', false],
      ['alice', false],
    ]);
    render(<VoiceSection groupId="g1" />);

    expect(screen.getByText('accord-moi')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('entoure d’un anneau vert l’avatar de la personne qui parle', () => {
    seedVoice('g1', [
      ['moi', false],
      ['alice', true],
    ]);
    render(<VoiceSection groupId="g1" />);

    const aliceRow = screen.getByText('Alice').closest('li');
    const selfRow = screen.getByText('accord-moi').closest('li');
    expect(aliceRow?.querySelector('.ring-green')).not.toBeNull();
    expect(selfRow?.querySelector('.ring-green')).toBeNull();
    // L'état de parole est aussi annoncé aux lecteurs d'écran.
    expect(screen.getByText('parle')).toBeInTheDocument();
  });

  it('n’affiche aucun participant quand on est connecté à un autre salon', () => {
    seedVoice('g2', [['moi', false]]);
    render(<VoiceSection groupId="g1" />);

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText('accord-moi')).not.toBeInTheDocument();
  });
});
