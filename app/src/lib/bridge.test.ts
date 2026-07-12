import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Le bridge est la frontière Tauri : on simule `invoke` et l'API fenêtre
// (import dynamique) pour vérifier l'interception de fermeture — régression
// du bug « la croix rouge ne ferme pas l'application » (macOS/Windows).

const invoke = vi.fn(async () => undefined);
const hide = vi.fn();
let capturedCallback: ((event: { preventDefault: () => void }) => void) | null = null;

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    hide,
    onCloseRequested: (cb: (event: { preventDefault: () => void }) => void) => {
      capturedCallback = cb;
      return Promise.resolve(() => {});
    },
  }),
}));

async function chargerInterception(shouldHide: () => boolean) {
  const { registerCloseInterception } = await import('./bridge');
  registerCloseInterception(shouldHide);
  await vi.waitFor(() => expect(capturedCallback).not.toBeNull());
}

describe('registerCloseInterception', () => {
  beforeEach(() => {
    invoke.mockClear();
    hide.mockClear();
    capturedCallback = null;
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it("quitte réellement l'application quand le mode tray est désactivé", async () => {
    await chargerInterception(() => false);
    const preventDefault = vi.fn();

    capturedCallback?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('app_quit');
    expect(hide).not.toHaveBeenCalled();
  });

  it('réduit dans la barre des menus (sans quitter) quand le mode tray est activé', async () => {
    await chargerInterception(() => true);
    const preventDefault = vi.fn();

    capturedCallback?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalledWith('app_quit');
  });
});
