/**
 * Tests d'éligibilité des notifications : croisement des réglages (MP,
 * groupes, « seulement en arrière-plan ») avec le focus de la fenêtre, et
 * exclusion systématique de ses propres messages.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingConversation,
  isNotificationEligible,
  isSoundEligible,
  PENDING_NAVIGATION_TTL_MS,
  rememberNotifiedConversation,
  takePendingConversation,
  type ConversationRef,
  type NotifyPrefs,
  type SoundEligibilityOptions,
} from './notifications';

const ALL_ON: NotifyPrefs = { dms: true, groups: true, onlyWhenUnfocused: true };

describe('isNotificationEligible', () => {
  it('notifie un MP entrant quand la fenêtre est en arrière-plan', () => {
    expect(
      isNotificationEligible({
        kind: 'dm',
        prefs: ALL_ON,
        windowFocused: false,
        isOwnMessage: false,
      }),
    ).toBe(true);
  });

  it('ne notifie jamais ses propres messages, réglages permissifs ou non', () => {
    for (const kind of ['dm', 'group'] as const) {
      expect(
        isNotificationEligible({
          kind,
          prefs: { dms: true, groups: true, onlyWhenUnfocused: false },
          windowFocused: false,
          isOwnMessage: true,
        }),
      ).toBe(false);
    }
  });

  it('respecte le réglage MP désactivé', () => {
    expect(
      isNotificationEligible({
        kind: 'dm',
        prefs: { ...ALL_ON, dms: false },
        windowFocused: false,
        isOwnMessage: false,
      }),
    ).toBe(false);
  });

  it('respecte le réglage groupes désactivé sans toucher aux MP', () => {
    const prefs: NotifyPrefs = { ...ALL_ON, groups: false };
    expect(
      isNotificationEligible({
        kind: 'group',
        prefs,
        windowFocused: false,
        isOwnMessage: false,
      }),
    ).toBe(false);
    expect(
      isNotificationEligible({
        kind: 'dm',
        prefs,
        windowFocused: false,
        isOwnMessage: false,
      }),
    ).toBe(true);
  });

  it('tait les notifications quand la fenêtre a le focus (mode arrière-plan)', () => {
    expect(
      isNotificationEligible({
        kind: 'dm',
        prefs: ALL_ON,
        windowFocused: true,
        isOwnMessage: false,
      }),
    ).toBe(false);
  });

  it('notifie même avec le focus quand le mode arrière-plan est désactivé', () => {
    expect(
      isNotificationEligible({
        kind: 'group',
        prefs: { ...ALL_ON, onlyWhenUnfocused: false },
        windowFocused: true,
        isOwnMessage: false,
      }),
    ).toBe(true);
  });
});

describe('isSoundEligible', () => {
  const BASE: SoundEligibilityOptions = {
    isOwnMessage: false,
    isDisplayedConversation: false,
    windowFocused: false,
    dnd: false,
  };

  it('joue le son pour un message entrant hors conversation affichée', () => {
    expect(isSoundEligible(BASE)).toBe(true);
  });

  it('ne joue jamais le son pour ses propres messages', () => {
    expect(isSoundEligible({ ...BASE, isOwnMessage: true, windowFocused: true })).toBe(
      false,
    );
  });

  it('tait le son en mode Ne pas déranger', () => {
    expect(isSoundEligible({ ...BASE, dnd: true })).toBe(false);
  });

  it('tait le son quand la conversation exacte est affichée et la fenêtre a le focus', () => {
    expect(
      isSoundEligible({ ...BASE, isDisplayedConversation: true, windowFocused: true }),
    ).toBe(false);
  });

  it('joue le son sur la conversation affichée si la fenêtre est en arrière-plan', () => {
    expect(
      isSoundEligible({ ...BASE, isDisplayedConversation: true, windowFocused: false }),
    ).toBe(true);
  });

  it('joue le son pour une autre conversation même fenêtre focalisée', () => {
    expect(
      isSoundEligible({ ...BASE, isDisplayedConversation: false, windowFocused: true }),
    ).toBe(true);
  });

  it('mode par défaut (absent) : joue pour tous les messages, comme avant', () => {
    expect(isSoundEligible(BASE)).toBe(true);
  });

  it('mode « aucun » : ne joue jamais, mention ou non', () => {
    expect(isSoundEligible({ ...BASE, mode: 'none' })).toBe(false);
    expect(isSoundEligible({ ...BASE, mode: 'none', isMention: true })).toBe(false);
  });

  it('mode « mentions seulement » : tait les messages ordinaires', () => {
    expect(isSoundEligible({ ...BASE, mode: 'mentionsOnly', isMention: false })).toBe(
      false,
    );
  });

  it('mode « mentions seulement » : joue pour une mention', () => {
    expect(isSoundEligible({ ...BASE, mode: 'mentionsOnly', isMention: true })).toBe(true);
  });

  it('mode « tous » : joue pour un message ordinaire comme pour une mention', () => {
    expect(isSoundEligible({ ...BASE, mode: 'all', isMention: false })).toBe(true);
    expect(isSoundEligible({ ...BASE, mode: 'all', isMention: true })).toBe(true);
  });
});

describe('sendNativeNotification — réglage « Notifications natives »', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('ne fait rien quand le réglage est désactivé, même dans Tauri', async () => {
    vi.doMock('./bridge', () => ({ isTauri: () => true }));
    const { sendNativeNotification } = await import('./notifications');
    const { useUi } = await import('../stores/ui');

    useUi.getState().setNotifyNative(false);
    const sent = await sendNativeNotification('Titre', 'Corps');

    expect(sent).toBe(false);

    useUi.getState().setNotifyNative(true);
    vi.doUnmock('./bridge');
  });
});

describe('notification click navigation (pending registry)', () => {
  const DM: ConversationRef = { kind: 'dm', peer: 'pair-1' };
  const GROUP: ConversationRef = {
    kind: 'group',
    groupId: 'g-1',
    channelId: 'c-1',
  };

  beforeEach(() => {
    clearPendingConversation();
  });

  it('returns the remembered conversation exactly once', () => {
    rememberNotifiedConversation(DM, 1_000);

    expect(takePendingConversation(2_000)).toEqual(DM);
    // Consumed: a second focus must not navigate again.
    expect(takePendingConversation(2_000)).toBeNull();
  });

  it('returns null when no notification was sent', () => {
    expect(takePendingConversation()).toBeNull();
  });

  it('expires beyond the navigation window', () => {
    rememberNotifiedConversation(GROUP, 1_000);

    expect(takePendingConversation(1_000 + PENDING_NAVIGATION_TTL_MS + 1)).toBeNull();
  });

  it('stays valid right at the navigation window boundary', () => {
    rememberNotifiedConversation(GROUP, 1_000);

    expect(takePendingConversation(1_000 + PENDING_NAVIGATION_TTL_MS)).toEqual(GROUP);
  });

  it('replaces the previous pending conversation with the latest one', () => {
    rememberNotifiedConversation(DM, 1_000);
    rememberNotifiedConversation(GROUP, 2_000);

    expect(takePendingConversation(3_000)).toEqual(GROUP);
  });

  it('clears explicitly (logout)', () => {
    rememberNotifiedConversation(DM, 1_000);
    clearPendingConversation();

    expect(takePendingConversation(1_500)).toBeNull();
  });
});
