/** Tests de la persistance de navigation : carte salon/serveur et dernier MP. */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadLastChannelByServer,
  loadLastDm,
  saveLastChannelByServer,
  saveLastDm,
} from './navPersistence';

beforeEach(() => {
  window.localStorage.clear();
});

describe('lastChannelByServer', () => {
  it('fait un aller-retour fidèle', () => {
    saveLastChannelByServer({ g1: 'c1', g2: 'c2' });
    expect(loadLastChannelByServer()).toEqual({ g1: 'c1', g2: 'c2' });
  });

  it('rend une carte vide sans valeur stockée', () => {
    expect(loadLastChannelByServer()).toEqual({});
  });

  it('ignore les valeurs non-chaînes et le JSON corrompu', () => {
    window.localStorage.setItem(
      'accord.nav.lastChannelByServer',
      JSON.stringify({ g1: 'c1', g2: 42, g3: null }),
    );
    expect(loadLastChannelByServer()).toEqual({ g1: 'c1' });

    window.localStorage.setItem('accord.nav.lastChannelByServer', '{pas du json');
    expect(loadLastChannelByServer()).toEqual({});
  });

  it('replie sur une carte vide si la valeur n’est pas un objet', () => {
    window.localStorage.setItem('accord.nav.lastChannelByServer', '["a","b"]');
    expect(loadLastChannelByServer()).toEqual({});
  });
});

describe('lastDm', () => {
  it('enregistre et relit le dernier pair', () => {
    saveLastDm('peer-1');
    expect(loadLastDm()).toBe('peer-1');
  });

  it('efface l’entrée quand on enregistre null', () => {
    saveLastDm('peer-1');
    saveLastDm(null);
    expect(loadLastDm()).toBeNull();
  });
});
