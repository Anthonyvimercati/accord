/** Tests de la résolution des résultats de recherche dans les historiques. */

import { describe, expect, it } from 'vitest';
import type { DmMessage, GroupMessage } from './api';
import { resolveSearchHits } from './search';

function dmMsg(
  id: string,
  text: string,
  sentMs: number,
  extra: Partial<DmMessage> = {},
): DmMessage {
  return {
    msg_id: id,
    author: 'auteur',
    lamport: sentMs,
    sent_ms: sentMs,
    acked: true,
    deleted: false,
    body: { type: 'text', text, reply_to: null, attachments: 0 },
    edited: null,
    ...extra,
  };
}

function groupMsg(id: string, text: string, sentMs: number): GroupMessage {
  return {
    msg_id: id,
    channel_id: 'salon1',
    author: 'auteur',
    lamport: sentMs,
    sent_ms: sentMs,
    deleted: false,
    body: { type: 'text', text, reply_to: null, attachments: 0 },
    edited: null,
  };
}

describe('resolveSearchHits', () => {
  it('retrouve les messages dans les MP et les salons chargés', () => {
    const dms = { pair1: [dmMsg('m1', 'bonjour', 1000)] };
    const groups = { 'groupe1/salon1': [groupMsg('m2', 'salut le groupe', 2000)] };

    const { hits, unresolved } = resolveSearchHits(['m1', 'm2'], dms, groups);

    expect(unresolved).toBe(0);
    expect(hits).toHaveLength(2);
    // Les plus récents d'abord.
    expect(hits[0]).toMatchObject({
      msgId: 'm2',
      text: 'salut le groupe',
      location: { kind: 'group', groupId: 'groupe1', channelId: 'salon1' },
    });
    expect(hits[1]).toMatchObject({
      msgId: 'm1',
      text: 'bonjour',
      location: { kind: 'dm', peer: 'pair1' },
    });
  });

  it('compte les identifiants hors des historiques chargés', () => {
    const { hits, unresolved } = resolveSearchHits(['inconnu1', 'inconnu2'], {}, {});
    expect(hits).toHaveLength(0);
    expect(unresolved).toBe(2);
  });

  it('privilégie le dernier texte édité', () => {
    const dms = { pair1: [dmMsg('m1', 'brouillon', 1000, { edited: 'version finale' })] };
    const { hits } = resolveSearchHits(['m1'], dms, {});
    expect(hits[0]?.text).toBe('version finale');
  });

  it('écarte les messages supprimés ou sans texte affichable', () => {
    const dms = {
      pair1: [
        dmMsg('efface', 'disparu', 1000, { deleted: true }),
        dmMsg('meta', '', 2000, { body: { type: 'meta' } }),
      ],
    };
    const { hits, unresolved } = resolveSearchHits(['efface', 'meta'], dms, {});
    expect(hits).toHaveLength(0);
    expect(unresolved).toBe(2);
  });
});
