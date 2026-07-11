/**
 * Traduit `event.group_event_started` en toast discret. Fonction pure —
 * décidée séparément du câblage d'événements (`AppShell`) pour rester
 * testable sans monter l'arbre React, même idiome que `callEndedToast`
 * (`lib/callToast.ts`).
 */

import type { Dict } from '../i18n';
import { interpolate } from '../i18n';

export interface EventStartedToast {
  kind: 'info';
  text: string;
}

export function eventStartedToast(t: Dict, title: string): EventStartedToast {
  return { kind: 'info', text: interpolate(t.groups.eventStartedToast, { title }) };
}
