/**
 * Tests du sélecteur de comptes : affichage des comptes connus, ouverture
 * de l'invite de phrase de passe au clic, déverrouillage du bon compte à la
 * soumission, bascule vers « Ajouter un compte » / « Importer ».
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { backupImport, type AccountMeta } from '../lib/bridge';
import { useSession } from '../stores/session';
import { useUi } from '../stores/ui';
import { AccountPicker } from './AccountPicker';

// Sauvegarde : seul l'import est simulé (sélecteur natif + commande hôte
// indisponibles sous vitest), le reste du pont reste intact pour le store.
vi.mock('../lib/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/bridge')>()),
  backupImport: vi.fn(async () => null),
}));

const accounts: AccountMeta[] = [
  {
    id: 'a1',
    name: 'Alex',
    created_ms: 1,
    last_used_ms: 1_700_000_000_000,
    is_legacy: true,
    pubkey_short: 'deadbeef',
  },
  {
    id: 'a2',
    name: 'Compte pro',
    created_ms: 2,
    last_used_ms: 1_700_000_100_000,
    is_legacy: false,
    pubkey_short: null,
  },
];

beforeEach(() => {
  useUi.setState({ lang: 'fr', toasts: [] });
  useSession.setState({
    accounts,
    error: null,
    unlockAccount: vi.fn(async () => {}),
    createAccount: vi.fn(async () => {}),
    restoreAccount: vi.fn(async () => {}),
    loadAccounts: vi.fn(async () => {}),
  });
});

describe('AccountPicker — liste', () => {
  it('affiche une ligne par compte connu', () => {
    render(<AccountPicker />);

    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('Compte pro')).toBeInTheDocument();
  });

  it('affiche le préfixe de clé publique quand il est connu', () => {
    render(<AccountPicker />);

    expect(screen.getByText(/deadbeef/)).toBeInTheDocument();
  });

  it('borne la liste et garde le panneau accessible à faible hauteur', () => {
    const { container } = render(<AccountPicker />);

    expect(screen.getByRole('list')).toHaveClass('max-h-64', 'overflow-y-auto');
    expect(container.firstElementChild).toHaveClass('overflow-y-auto');
    expect(screen.getByRole('button', { name: 'Ajouter un compte' })).not.toHaveClass(
      'transition-all',
    );
  });
});

describe('AccountPicker — déverrouillage', () => {
  it('déverrouille le compte cliqué avec la phrase de passe saisie', async () => {
    const unlockAccount = vi.fn(async () => {});
    useSession.setState({ unlockAccount });
    render(<AccountPicker />);

    fireEvent.click(screen.getByRole('button', { name: 'Déverrouiller Alex' }));
    fireEvent.change(screen.getByLabelText('Phrase de passe'), {
      target: { value: 'phrase-de-passe-longue' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Déverrouiller' }));

    expect(unlockAccount).toHaveBeenCalledWith('a1', 'phrase-de-passe-longue');
  });

  it("n'ouvre l'invite que pour le compte cliqué", () => {
    render(<AccountPicker />);

    fireEvent.click(screen.getByRole('button', { name: 'Déverrouiller Alex' }));

    expect(screen.getByLabelText('Phrase de passe')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Déverrouiller Compte pro' }));
    // Une seule invite affichée à la fois : le champ précédent reste unique.
    expect(screen.getAllByLabelText('Phrase de passe')).toHaveLength(1);
  });

  it('affiche l’erreur du store (phrase de passe incorrecte)', () => {
    useSession.setState({ error: 'Phrase de passe incorrecte' });
    render(<AccountPicker />);

    expect(screen.getByText('Phrase de passe incorrecte')).toBeInTheDocument();
  });
});

describe('AccountPicker — ajout / import', () => {
  it('« Ajouter un compte » ouvre le formulaire de création câblé sur createAccount', () => {
    render(<AccountPicker />);

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un compte' }));

    expect(
      screen.getByRole('button', { name: 'Retour à la liste des comptes' }),
    ).toBeInTheDocument();
  });

  it('« Importer depuis une phrase de récupération » ouvre le formulaire de restauration', () => {
    render(<AccountPicker />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Importer depuis une phrase de récupération' }),
    );

    expect(
      screen.getByRole('heading', { name: 'Restaurer une identité' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Retour à la liste des comptes' }),
    ).toBeInTheDocument();
  });
});

describe('AccountPicker — import de sauvegarde', () => {
  it('propose « Importer une sauvegarde » sur la liste des comptes', () => {
    // Arrange / Act
    render(<AccountPicker />);

    // Assert
    expect(screen.getByRole('button', { name: 'Importer une sauvegarde' })).toBeEnabled();
  });

  it('importe l’archive puis recharge la liste et confirme par un toast', async () => {
    // Arrange : l'hôte rend les métadonnées du compte fraîchement importé.
    vi.mocked(backupImport).mockResolvedValueOnce({
      id: 'importe-1',
      name: 'Compte importé',
      created_ms: 3,
      last_used_ms: 0,
      is_legacy: false,
      pubkey_short: null,
    });
    const loadAccounts = vi.fn(async () => {});
    useSession.setState({ loadAccounts });
    render(<AccountPicker />);

    // Act : ouvre la saisie (phrase facultative) puis confirme.
    fireEvent.click(screen.getByRole('button', { name: 'Importer une sauvegarde' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    // Assert : liste rechargée (le compte apparaît) et toast d'orientation
    // vers le déverrouillage normal par phrase de passe.
    await waitFor(() => expect(loadAccounts).toHaveBeenCalledTimes(1));
    expect(
      useUi
        .getState()
        .toasts.some((t) => t.kind === 'info' && /phrase de passe/.test(t.text)),
    ).toBe(true);
  });

  it('ne recharge rien quand le sélecteur est annulé', async () => {
    // Arrange : sélecteur natif annulé — le pont rend null sans commande hôte.
    vi.mocked(backupImport).mockResolvedValueOnce(null);
    const loadAccounts = vi.fn(async () => {});
    useSession.setState({ loadAccounts });
    render(<AccountPicker />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Importer une sauvegarde' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    // Assert : la saisie reste ouverte (bouton Confirmer réactivé), ni
    // rechargement ni toast.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirmer' })).toBeEnabled(),
    );
    expect(loadAccounts).not.toHaveBeenCalled();
    expect(useUi.getState().toasts).toHaveLength(0);
  });

  it('affiche le message d’erreur hôte en toast quand l’import échoue', async () => {
    // Arrange : archive rejetée (zip-slip, coffre absent…) — message hôte lisible.
    vi.mocked(backupImport).mockRejectedValueOnce(
      new Error('entrée invalide : archive sans coffre d’identité (identity.vault)'),
    );
    render(<AccountPicker />);

    // Act : ouvre la saisie puis confirme (l'échec vient de l'archive, pas de
    // la phrase de passe).
    fireEvent.click(screen.getByRole('button', { name: 'Importer une sauvegarde' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    // Assert
    await waitFor(() => {
      expect(
        useUi.getState().toasts.some((t) => t.kind === 'error' && /coffre/.test(t.text)),
      ).toBe(true);
    });
  });
});
