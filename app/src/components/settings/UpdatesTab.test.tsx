/**
 * Onglet Mises à jour : les notes de version (extraites du CHANGELOG, donc en
 * Markdown) doivent être rendues mises en forme, pas en texte brut.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdater } from '../../stores/updater';
import { UpdatesTab } from './UpdatesTab';

vi.mock('../../lib/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/bridge')>()),
  isTauri: () => true,
}));

vi.mock('../../lib/updater', () => ({
  RELEASES_URL: 'https://github.com/Gomouu/accord/releases/latest',
  checkForUpdate: vi.fn(),
  downloadAndInstall: vi.fn(),
  restartApp: vi.fn(),
}));

beforeEach(() => {
  useUpdater.setState({
    status: 'idle',
    version: null,
    notes: null,
    progress: null,
    error: null,
    dismissedVersion: null,
  });
});

describe('UpdatesTab — notes de version', () => {
  it('rend le Markdown des notes (titres, gras, code) au lieu du texte brut', () => {
    useUpdater.setState({
      status: 'available',
      version: '3.4.0',
      notes: '### Added\n\n- **Emoji autocomplete**: type `:` to open it.',
    });
    render(<UpdatesTab />);

    expect(screen.getByRole('heading', { name: 'Added' })).toBeInTheDocument();
    expect(screen.getByText('Emoji autocomplete').tagName).toBe('STRONG');
    expect(screen.getByText(':').tagName).toBe('CODE');
    expect(screen.queryByText(/###/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it('masque la section notes quand il n’y en a pas', () => {
    useUpdater.setState({ status: 'available', version: '3.4.0', notes: null });
    render(<UpdatesTab />);

    expect(screen.queryByRole('heading', { name: 'Added' })).not.toBeInTheDocument();
  });
});
