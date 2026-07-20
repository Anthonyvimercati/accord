/**
 * Tests de l'annonceur de nouveaux messages (accessibilité) : l'historique
 * initial n'est pas annoncé, un message entrant l'est, ses propres envois et
 * les suppressions ne le sont pas.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useUi } from '../stores/ui';
import type { DisplayMessage } from './messageModel';
import { MessageAnnouncer } from './MessageAnnouncer';

function msg(id: string, author: string, deleted = false): DisplayMessage {
  return {
    msg_id: id,
    author,
    sent_ms: 0,
    body: { type: 'text', text: 't' },
    deleted,
  } as DisplayMessage;
}

const nameOf = (a: string) => (a === 'alice' ? 'Alice' : a);

beforeEach(() => {
  useUi.setState({ lang: 'fr' });
});

describe('MessageAnnouncer', () => {
  it('n’annonce pas l’historique présent à l’ouverture', () => {
    render(
      <MessageAnnouncer
        messages={[msg('m1', 'alice')]}
        selfPubkey="moi"
        nameOf={nameOf}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('annonce un message entrant', () => {
    const { rerender } = render(
      <MessageAnnouncer
        messages={[msg('m1', 'alice')]}
        selfPubkey="moi"
        nameOf={nameOf}
      />,
    );
    rerender(
      <MessageAnnouncer
        messages={[msg('m1', 'alice'), msg('m2', 'alice')]}
        selfPubkey="moi"
        nameOf={nameOf}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Nouveau message de Alice');
  });

  it('n’annonce pas ses propres envois ni un message supprimé', () => {
    const { rerender } = render(
      <MessageAnnouncer
        messages={[msg('m1', 'alice')]}
        selfPubkey="moi"
        nameOf={nameOf}
      />,
    );
    rerender(
      <MessageAnnouncer
        messages={[msg('m1', 'alice'), msg('m2', 'moi')]}
        selfPubkey="moi"
        nameOf={nameOf}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
