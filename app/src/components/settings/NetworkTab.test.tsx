/**
 * Tests de l'onglet Réseau : affichage de l'adresse à communiquer, ajout d'un
 * pair par adresse (network.add_peer), et rafraîchissement sur event.network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../lib/client', () => {
  const handlers = new Set<(method: string, params: unknown) => void>();
  return {
    api: {
      networkStatus: vi.fn(),
      networkAddPeer: vi.fn(),
      networkRemovePeer: vi.fn(),
    },
    rpc: {
      onEvent: (handler: (method: string, params: unknown) => void) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      emitEvent: (method: string, params: unknown) => {
        for (const handler of handlers) handler(method, params);
      },
    },
  };
});

import { api, rpc } from '../../lib/client';
import { NetworkTab } from './NetworkTab';

const statusMock = api.networkStatus as unknown as Mock;
const addPeerMock = api.networkAddPeer as unknown as Mock;
const fakeRpc = rpc as unknown as {
  emitEvent: (method: string, params: unknown) => void;
};

const STATUS = {
  p2p_port: 48016,
  local_addrs: ['203.0.113.4:48016'],
  bootstrap: [],
  connected_peers: 0,
  dht_nodes: 0,
};

async function renderTab(): Promise<void> {
  render(<NetworkTab />);
  await act(async () => {});
}

beforeEach(() => {
  statusMock.mockReset();
  addPeerMock.mockReset();
  statusMock.mockResolvedValue(STATUS);
});

describe('NetworkTab', () => {
  it('affiche l’adresse locale à communiquer', async () => {
    await renderTab();
    expect(await screen.findByText('203.0.113.4:48016')).toBeInTheDocument();
    expect(statusMock).toHaveBeenCalled();
  });

  it('ajoute un pair par son adresse via network.add_peer', async () => {
    addPeerMock.mockResolvedValue({ ...STATUS, bootstrap: ['198.51.100.7:48016'] });
    await renderTab();

    const input = screen.getByPlaceholderText(/ip:port/i);
    fireEvent.change(input, { target: { value: '198.51.100.7:48016' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(addPeerMock).toHaveBeenCalledWith('198.51.100.7:48016'));
    expect(await screen.findByText('198.51.100.7:48016')).toBeInTheDocument();
  });

  it('rafraîchit l’état sur event.network', async () => {
    await renderTab();
    expect(statusMock).toHaveBeenCalledTimes(1);

    statusMock.mockResolvedValue({ ...STATUS, connected_peers: 2 });
    await act(async () => {
      fakeRpc.emitEvent('event.network', { connected_peers: 2, dht_nodes: 5 });
    });

    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
  });
});
