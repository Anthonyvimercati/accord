/** Tests du validateur de préfixe des liens d'invitation partageables. */

import { describe, expect, it } from 'vitest';
import { INVITE_LINK_PREFIX, isInviteLink } from './invite';

describe('isInviteLink', () => {
  it('accepte un lien bien formé', () => {
    expect(isInviteLink(`${INVITE_LINK_PREFIX}AbCd1234`)).toBe(true);
  });

  it('rejette le préfixe seul, sans code', () => {
    expect(isInviteLink(INVITE_LINK_PREFIX)).toBe(false);
  });

  it('rejette une chaîne vide', () => {
    expect(isInviteLink('')).toBe(false);
  });

  it('rejette un schéma étranger ou un texte quelconque', () => {
    expect(isInviteLink('https://example.com/invite/XXXX')).toBe(false);
    expect(isInviteLink('XXXX')).toBe(false);
    expect(isInviteLink('accord://friend/XXXX')).toBe(false);
  });
});
