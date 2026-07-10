/**
 * Tests des préférences d'apparence du store d'interface : application
 * immédiate sur la racine du document, persistance localStorage et
 * validation des valeurs restaurées.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from './ui';

const root = document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  useUi.getState().setTheme('dark');
  useUi.getState().setDensity('comfortable');
  useUi.getState().setFontScale(100);
  window.localStorage.clear();
});

describe('useUi — thème', () => {
  it('applique le thème clair à la racine et le persiste', () => {
    useUi.getState().setTheme('light');

    expect(root.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('accord.theme')).toBe('light');
    expect(useUi.getState().theme).toBe('light');
  });

  it('revient au thème sombre', () => {
    useUi.getState().setTheme('light');
    useUi.getState().setTheme('dark');

    expect(root.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('accord.theme')).toBe('dark');
  });
});

describe('useUi — densité', () => {
  it('applique la densité compacte à la racine et la persiste', () => {
    useUi.getState().setDensity('compact');

    expect(root.dataset.density).toBe('compact');
    expect(window.localStorage.getItem('accord.density')).toBe('compact');
    expect(useUi.getState().density).toBe('compact');
  });
});

describe('useUi — taille de police', () => {
  it('applique l’échelle en pourcentage sur la racine et la persiste', () => {
    useUi.getState().setFontScale(120);

    expect(root.style.fontSize).toBe('120%');
    expect(window.localStorage.getItem('accord.fontScale')).toBe('120');
    expect(useUi.getState().fontScale).toBe(120);
  });
});

describe('useUi — langue', () => {
  it('persiste la langue choisie', () => {
    useUi.getState().setLang('en');

    expect(window.localStorage.getItem('accord.lang')).toBe('en');
    expect(useUi.getState().lang).toBe('en');

    useUi.getState().setLang('fr');
    expect(window.localStorage.getItem('accord.lang')).toBe('fr');
  });
});

describe('useUi — saut au message (jump)', () => {
  beforeEach(() => {
    useUi.setState({ view: { kind: 'friends' }, jump: null });
  });

  it('requestJump bascule la vue et incrémente le nonce à chaque appel', () => {
    const view = { kind: 'dm', peer: 'pair' } as const;
    useUi.getState().requestJump(view, 'm1');

    const first = useUi.getState().jump;
    expect(useUi.getState().view).toEqual(view);
    expect(first).toMatchObject({ view, msgId: 'm1' });

    useUi.getState().requestJump(view, 'm2');
    expect(useUi.getState().jump?.nonce).toBe((first?.nonce ?? 0) + 1);
  });

  it('clearJump consomme la demande de saut', () => {
    useUi.getState().requestJump({ kind: 'dm', peer: 'pair' }, 'm1');
    useUi.getState().clearJump();

    expect(useUi.getState().jump).toBeNull();
  });

  it('setView efface un saut en attente (navigation ordinaire)', () => {
    useUi.getState().requestJump({ kind: 'dm', peer: 'pair' }, 'm1');
    useUi.getState().setView({ kind: 'friends' });

    expect(useUi.getState().jump).toBeNull();
  });
});

describe('useUi — restauration au démarrage', () => {
  it('restaure les préférences persistées valides', async () => {
    window.localStorage.setItem('accord.theme', 'light');
    window.localStorage.setItem('accord.density', 'compact');
    window.localStorage.setItem('accord.fontScale', '110');

    vi.resetModules();
    const fresh = await import('./ui');

    expect(fresh.useUi.getState().theme).toBe('light');
    expect(fresh.useUi.getState().density).toBe('compact');
    expect(fresh.useUi.getState().fontScale).toBe(110);
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.density).toBe('compact');
    expect(root.style.fontSize).toBe('110%');
  });

  it('replie sur les défauts quand les valeurs persistées sont invalides', async () => {
    window.localStorage.setItem('accord.theme', 'fluo');
    window.localStorage.setItem('accord.density', 'serré');
    window.localStorage.setItem('accord.fontScale', '400');

    vi.resetModules();
    const fresh = await import('./ui');

    expect(fresh.useUi.getState().theme).toBe('dark');
    expect(fresh.useUi.getState().density).toBe('comfortable');
    expect(fresh.useUi.getState().fontScale).toBe(100);
    expect(root.dataset.theme).toBe('dark');
  });
});
