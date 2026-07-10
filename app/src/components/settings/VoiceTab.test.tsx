/**
 * Tests de l'onglet Voix : vumètre piloté par `event.voice_level` (transform
 * scaleX, surbrillance en parole), cycle du test micro (démarrage, arrêt,
 * arrêt au démontage), sélecteurs de périphériques (voice.devices /
 * voice.set_devices) et capture de la touche d'appui-pour-parler.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../lib/client', () => {
  const handlers = new Set<(method: string, params: unknown) => void>();
  return {
    api: {
      voiceDevices: vi.fn(),
      voiceSetDevices: vi.fn(),
      voiceMicTest: vi.fn(),
    },
    rpc: {
      onEvent: (handler: (method: string, params: unknown) => void) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      /** Simule une notification poussée par le nœud (tests uniquement). */
      emitEvent: (method: string, params: unknown) => {
        for (const handler of handlers) handler(method, params);
      },
    },
  };
});

import { api, rpc } from '../../lib/client';
import { useUi } from '../../stores/ui';
import { MicMeter, VoiceTab } from './VoiceTab';

const devicesMock = api.voiceDevices as unknown as Mock;
const setDevicesMock = api.voiceSetDevices as unknown as Mock;
const micTestMock = api.voiceMicTest as unknown as Mock;
const fakeRpc = rpc as unknown as {
  emitEvent: (method: string, params: unknown) => void;
};

const NO_DEVICES = {
  inputs: [],
  outputs: [],
  selected_input: null,
  selected_output: null,
};

/** Rend l'onglet et attend la fin du chargement initial des périphériques. */
async function renderVoiceTab(): Promise<ReturnType<typeof render>> {
  const view = render(<VoiceTab />);
  await act(async () => {});
  return view;
}

beforeEach(() => {
  window.localStorage.clear();
  useUi.setState({ lang: 'fr', toasts: [], pttEnabled: false, pttKey: 'Space' });
  devicesMock.mockReset();
  setDevicesMock.mockReset();
  micTestMock.mockReset();
  devicesMock.mockResolvedValue(NO_DEVICES);
  setDevicesMock.mockResolvedValue({});
  micTestMock.mockResolvedValue({});
});

describe('MicMeter — vumètre', () => {
  it('applique le niveau en transform scaleX (compositor-friendly)', () => {
    render(<MicMeter level={0.5} speaking={false} />);

    const meter = screen.getByRole('meter', { name: 'Niveau du micro' });
    expect(meter).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByTestId('mic-meter-bar').style.transform).toBe('scaleX(0.5)');
  });

  it('surligne la barre quand le nœud détecte de la parole', () => {
    render(<MicMeter level={0.8} speaking />);

    expect(screen.getByTestId('mic-meter-bar').className).toContain('bg-green');
  });

  it('borne les niveaux hors contrat dans [0, 1]', () => {
    render(<MicMeter level={1.7} speaking={false} />);

    expect(screen.getByTestId('mic-meter-bar').style.transform).toBe('scaleX(1)');
  });
});

describe('VoiceTab — test du micro', () => {
  it('démarre le test puis anime le vumètre sur event.voice_level', async () => {
    await renderVoiceTab();

    fireEvent.click(screen.getByRole('button', { name: 'Tester le micro' }));
    await waitFor(() => expect(micTestMock).toHaveBeenCalledWith(true));
    await screen.findByRole('button', { name: 'Arrêter le test' });

    act(() => {
      fakeRpc.emitEvent('event.voice_level', { level: 0.6, speaking: true });
    });

    const bar = screen.getByTestId('mic-meter-bar');
    expect(bar.style.transform).toBe('scaleX(0.6)');
    expect(bar.className).toContain('bg-green');
  });

  it('arrête proprement le test au clic et remet le vumètre à zéro', async () => {
    await renderVoiceTab();
    fireEvent.click(screen.getByRole('button', { name: 'Tester le micro' }));
    await screen.findByRole('button', { name: 'Arrêter le test' });

    fireEvent.click(screen.getByRole('button', { name: 'Arrêter le test' }));

    await waitFor(() => expect(micTestMock).toHaveBeenLastCalledWith(false));
    expect(screen.getByTestId('mic-meter-bar').style.transform).toBe('scaleX(0)');
  });

  it('arrête le test au démontage de l’onglet (fermeture du modal)', async () => {
    const { unmount } = await renderVoiceTab();
    fireEvent.click(screen.getByRole('button', { name: 'Tester le micro' }));
    await screen.findByRole('button', { name: 'Arrêter le test' });

    unmount();

    await waitFor(() => expect(micTestMock).toHaveBeenLastCalledWith(false));
  });

  it('affiche l’erreur explicite du nœud si le matériel est indisponible', async () => {
    micTestMock.mockRejectedValueOnce(new Error('capture audio indisponible'));
    await renderVoiceTab();

    fireEvent.click(screen.getByRole('button', { name: 'Tester le micro' }));

    await waitFor(() => {
      expect(
        useUi.getState().toasts.some((t) => t.text === 'capture audio indisponible'),
      ).toBe(true);
    });
  });
});

describe('VoiceTab — périphériques', () => {
  it('liste les périphériques et présélectionne la sélection persistée', async () => {
    devicesMock.mockResolvedValue({
      inputs: ['Micro USB'],
      outputs: ['Casque'],
      selected_input: 'Micro USB',
      selected_output: null,
    });
    await renderVoiceTab();

    const input = await screen.findByRole('combobox', { name: 'Entrée (micro)' });
    await waitFor(() => expect(input).toHaveValue('Micro USB'));
    expect(
      screen.getByRole('combobox', { name: 'Sortie (casque, haut-parleurs)' }),
    ).toHaveValue('');
  });

  it('sans matériel, ne propose que « Périphérique par défaut »', async () => {
    await renderVoiceTab();

    await waitFor(() => expect(devicesMock).toHaveBeenCalled());
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2); // une par sélecteur
    for (const option of options) {
      expect(option).toHaveTextContent('Périphérique par défaut');
    }
  });

  it('applique un changement de sortie via voice.set_devices', async () => {
    devicesMock.mockResolvedValue({
      inputs: ['Micro USB'],
      outputs: ['Casque'],
      selected_input: null,
      selected_output: null,
    });
    await renderVoiceTab();
    const output = await screen.findByRole('combobox', {
      name: 'Sortie (casque, haut-parleurs)',
    });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Casque' })).toBeInTheDocument(),
    );

    fireEvent.change(output, { target: { value: 'Casque' } });

    await waitFor(() =>
      expect(setDevicesMock).toHaveBeenCalledWith({ output: 'Casque' }),
    );
  });
});

describe('VoiceTab — appui-pour-parler', () => {
  it('capture la prochaine touche pour l’appui-pour-parler et la persiste', async () => {
    await renderVoiceTab();

    fireEvent.click(screen.getByRole('button', { name: 'Touche' }));
    expect(screen.getByText('Appuyez sur une touche…')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'v', code: 'KeyV' });

    expect(useUi.getState().pttKey).toBe('KeyV');
    expect(window.localStorage.getItem('accord.pttKey')).toBe('KeyV');
    expect(screen.getByRole('button', { name: 'Touche' })).toHaveTextContent('V');
  });

  it('annule la capture avec Échap sans changer la touche', async () => {
    await renderVoiceTab();
    fireEvent.click(screen.getByRole('button', { name: 'Touche' }));

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    expect(useUi.getState().pttKey).toBe('Space');
  });

  it('bascule et persiste l’activation de l’appui-pour-parler', async () => {
    await renderVoiceTab();

    const toggle = screen.getByRole('switch', { name: 'Activer l’appui-pour-parler' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);

    expect(useUi.getState().pttEnabled).toBe(true);
    expect(window.localStorage.getItem('accord.pttEnabled')).toBe('true');
  });
});
