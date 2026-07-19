/**
 * Tests du store de présence des brouillons : signalement par le composeur
 * (ajout/retrait), stabilité de la référence quand rien ne change, et
 * sélecteur `hasDraft`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { hasDraft, useDrafts } from './drafts';

beforeEach(() => {
  useDrafts.setState({ keys: {} });
});

describe('useDrafts.noteDraft', () => {
  it('ajoute la clé quand un texte non vide est signalé', () => {
    useDrafts.getState().noteDraft('draft:dm:alice', true);
    expect(useDrafts.getState().keys['draft:dm:alice']).toBe(true);
  });

  it('retire la clé quand le brouillon se vide', () => {
    useDrafts.getState().noteDraft('draft:dm:alice', true);
    useDrafts.getState().noteDraft('draft:dm:alice', false);
    expect(useDrafts.getState().keys['draft:dm:alice']).toBeUndefined();
  });

  it('ignore une clé nulle et ne change pas la référence sans transition', () => {
    const avant = useDrafts.getState().keys;
    useDrafts.getState().noteDraft(null, true);
    useDrafts.getState().noteDraft('draft:dm:bob', false);
    expect(useDrafts.getState().keys).toBe(avant);
  });
});

describe('hasDraft', () => {
  it('rend vrai seulement pour une clé présente', () => {
    expect(hasDraft({ 'draft:dm:alice': true }, 'draft:dm:alice')).toBe(true);
    expect(hasDraft({ 'draft:dm:alice': true }, 'draft:dm:bob')).toBe(false);
    expect(hasDraft({}, null)).toBe(false);
  });
});
