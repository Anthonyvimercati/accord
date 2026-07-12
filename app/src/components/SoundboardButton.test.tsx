/**
 * Tests d'accessibilité du popover Soundboard : nom accessible du
 * déclencheur, `aria-expanded`, focus déplacé dans le panneau à l'ouverture,
 * Échap qui ferme ET rend le focus au déclencheur, bouclage de Tab (piège à
 * focus sur déclencheur + panneau).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../lib/client', () => ({
  rpc: { call: vi.fn(), onEvent: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) },
  api: { groupsSoundboardPlay: vi.fn(() => Promise.resolve()) },
}));
vi.mock('../stores/soundboard', () => ({
  playSound: vi.fn(() => Promise.resolve()),
}));

import type { GroupStateJson, ServerSound } from '../lib/api';
import { useGroups } from '../stores/groups';
import { useUi } from '../stores/ui';
import { useVoice } from '../stores/voice';
import { SoundboardButton } from './SoundboardButton';

function groupState(sounds: ServerSound[]): GroupStateJson {
  return {
    group_id: 'g1',
    name: 'Guilde',
    icon: null,
    founder: null,
    members: [],
    bans: [],
    channels: [],
    categories: [],
    roles: [],
    invites: [],
    my_permissions: 0,
    sounds,
  };
}

function renderSoundboard(sounds: ServerSound[] = []) {
  useVoice.setState({
    active: { groupId: 'g1', channelId: 'c1', muted: false, isCall: false },
  });
  useGroups.setState({ states: { g1: groupState(sounds) } });
  return render(<SoundboardButton className="" />);
}

beforeEach(() => {
  useUi.setState({ lang: 'fr' });
});

describe('SoundboardButton — accessibilité du popover', () => {
  it('le déclencheur a un nom accessible et aria-expanded suit l’ouverture', () => {
    renderSoundboard();
    const trigger = screen.getByRole('button', { name: 'Soundboard' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Soundboard' })).toBeInTheDocument();
  });

  it('déplace le focus sur la première tuile à l’ouverture', () => {
    renderSoundboard([{ name: 'tada', merkle_root: 'ab'.repeat(32) }]);
    fireEvent.click(screen.getByRole('button', { name: 'Soundboard' }));

    // Le nom accessible de la tuile vient de son contenu (le nom du son).
    expect(screen.getByRole('button', { name: 'tada' })).toHaveFocus();
  });

  it('Échap ferme le popover et rend le focus au déclencheur', () => {
    renderSoundboard([{ name: 'tada', merkle_root: 'ab'.repeat(32) }]);
    const trigger = screen.getByRole('button', { name: 'Soundboard' });
    fireEvent.click(trigger);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Tab depuis le dernier élément reboucle sur le premier (piège à focus)', () => {
    renderSoundboard([{ name: 'tada', merkle_root: 'ab'.repeat(32) }]);
    const trigger = screen.getByRole('button', { name: 'Soundboard' });
    fireEvent.click(trigger);

    // La tuile (dernier focusable de l'enveloppe) a le focus : Tab doit
    // ramener au déclencheur (premier focusable) au lieu de s'échapper.
    fireEvent.keyDown(window, { key: 'Tab' });

    expect(trigger).toHaveFocus();
  });
});
