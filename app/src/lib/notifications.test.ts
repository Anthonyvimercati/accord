/**
 * Tests d'éligibilité des notifications : croisement des réglages (MP,
 * groupes, « seulement en arrière-plan ») avec le focus de la fenêtre, et
 * exclusion systématique de ses propres messages.
 */

import { describe, expect, it } from 'vitest';
import { isNotificationEligible, type NotifyPrefs } from './notifications';

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
