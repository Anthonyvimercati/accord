/**
 * Privacy dashboard tests: renders the report counts, storage facts and
 * egress rows (central servers = 0), and the network-down fallback.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../lib/client', () => ({
  rpc: { onEvent: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) },
  api: {
    privacyReport: vi.fn(),
  },
}));

import { api } from '../lib/client';
import type { PrivacyReport } from '../lib/api';
import { useUi } from '../stores/ui';
import { formatBytes, PrivacyDashboard } from './PrivacyDashboard';

const reportMock = api.privacyReport as unknown as Mock;

function report(overrides?: Partial<PrivacyReport['egress']>): PrivacyReport {
  return {
    counts: {
      friends: 2,
      dm_messages: 41,
      groups: 1,
      group_messages: 7,
      files: 3,
      pins: 5,
    },
    storage: { db_bytes: 262_144, file_bytes: 2048, db_encrypted_at_rest: true },
    egress: {
      available: true,
      bootstrap_peers: 1,
      dht_nodes: 12,
      connected_peers: 2,
      relay_circuits: 0,
      central_servers: 0,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ lang: 'fr' });
});

describe('PrivacyDashboard', () => {
  it('renders counts, storage and the zero-central-servers row', async () => {
    reportMock.mockResolvedValue(report());
    render(<PrivacyDashboard />);

    expect(await screen.findByText('Messages privés')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('Actif (SQLCipher)')).toBeInTheDocument();
    expect(screen.getByText('256.0 Kio')).toBeInTheDocument();
    expect(screen.getByText('Serveurs centraux contactés')).toBeInTheDocument();
    expect(
      screen.getByText('Nœuds DHT connus (annuaire pair-à-pair)'),
    ).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows the fallback line when the network runtime is down', async () => {
    reportMock.mockResolvedValue({
      ...report(),
      egress: {
        available: false,
        bootstrap_peers: 0,
        dht_nodes: 0,
        connected_peers: 0,
        relay_circuits: 0,
        central_servers: 0,
      },
    });
    render(<PrivacyDashboard />);

    expect(
      await screen.findByText('Réseau non démarré — aucune connexion sortante.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Serveurs centraux contactés')).not.toBeInTheDocument();
  });

  it('reports an unknown database size as a dash', async () => {
    reportMock.mockResolvedValue({
      ...report(),
      storage: { db_bytes: null, file_bytes: 0, db_encrypted_at_rest: true },
    });
    render(<PrivacyDashboard />);

    expect(
      await screen.findByText('Base locale (chiffrée SQLCipher)'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('formatBytes', () => {
  it('picks a readable unit', () => {
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(2048)).toBe('2.0 Kio');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 Mio');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 Gio');
  });
});
