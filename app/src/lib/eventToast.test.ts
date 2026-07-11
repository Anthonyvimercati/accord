/** Tests de `eventStartedToast` : traduction pure de `event.group_event_started` en toast. */

import { describe, expect, it } from 'vitest';
import { fr } from '../i18n/fr';
import { en } from '../i18n/en';
import { eventStartedToast } from './eventToast';

describe('eventStartedToast', () => {
  it('interpole le titre dans le libellé français', () => {
    expect(eventStartedToast(fr, 'Soirée jeux')).toEqual({
      kind: 'info',
      text: 'L’événement Soirée jeux commence.',
    });
  });

  it('interpole le titre dans le libellé anglais', () => {
    expect(eventStartedToast(en, 'Game night')).toEqual({
      kind: 'info',
      text: 'The event Game night is starting.',
    });
  });
});
