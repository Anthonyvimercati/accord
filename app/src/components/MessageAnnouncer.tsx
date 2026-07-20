/**
 * Annonce discrète des nouveaux messages au lecteur d'écran (accessibilité) :
 * une région `aria-live="polite"` masquée visuellement (`sr-only`) énonce
 * « Nouveau message de X » à chaque message entrant. L'historique déjà présent
 * à l'ouverture n'est jamais annoncé (amorçage silencieux) ; monter le composant
 * avec une `key` par conversation réamorce proprement au changement de vue.
 */

import { useEffect, useRef, useState } from 'react';
import { interpolate } from '../i18n';
import { useT } from '../stores/ui';
import type { DisplayMessage } from './messageModel';

interface MessageAnnouncerProps {
  messages: readonly DisplayMessage[];
  selfPubkey: string | null;
  nameOf: (author: string) => string;
}

export function MessageAnnouncer({
  messages,
  selfPubkey,
  nameOf,
}: MessageAnnouncerProps) {
  const t = useT();
  const [annonce, setAnnonce] = useState('');
  const dernierIdRef = useRef<string | null>(null);
  const amorceRef = useRef(false);

  useEffect(() => {
    const dernier = messages[messages.length - 1];
    const dernierId = dernier?.msg_id ?? null;
    if (!amorceRef.current) {
      // Premier rendu : on mémorise l'état sans annoncer tout l'historique.
      amorceRef.current = true;
      dernierIdRef.current = dernierId;
      return;
    }
    if (dernierId === null || dernierId === dernierIdRef.current) return;
    dernierIdRef.current = dernierId;
    // On n'annonce que les messages ENTRANTS (pas ses propres envois), non supprimés.
    if (dernier !== undefined && !dernier.deleted && dernier.author !== selfPubkey) {
      setAnnonce(interpolate(t.a11y.newMessage, { name: nameOf(dernier.author) }));
    }
  }, [messages, selfPubkey, nameOf, t]);

  return (
    // `role="status"` implique `aria-live="polite"` + `aria-atomic` : région
    // d'annonce polie, masquée visuellement (`sr-only`).
    <div role="status" className="sr-only">
      {annonce}
    </div>
  );
}
