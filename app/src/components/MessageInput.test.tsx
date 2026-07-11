/**
 * Tests de la zone de saisie avec pièces jointes : aperçus retirables,
 * bornes UI (10 pièces, 8 Mio), publication via files.share_bytes à l'envoi
 * (texte vide admis), collage de fichiers et signalement des échecs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MAX_TAILLE_PIECE } from '../lib/attachments';
import type { Contact, GroupStateJson } from '../lib/api';
import type {
  VoiceRecorderCallbacks,
  VoiceRecorderResult,
  VoiceRecorderError,
} from '../lib/voiceRecorder';
import { useContextMenu } from '../stores/contextMenu';
import { useFriends } from '../stores/friends';
import { useGroups } from '../stores/groups';
import { useSession } from '../stores/session';
import { useUi } from '../stores/ui';
import { MessageInput } from './MessageInput';

vi.mock('../lib/client', () => ({
  rpc: { onEvent: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) },
  api: { filesShareBytes: vi.fn() },
}));

/**
 * Enregistreur factice piloté depuis les tests : capture les rappels passés
 * par `MessageInput` pour simuler `onTick`/`onStop`/`onError` sans toucher au
 * micro réel (déjà couvert isolément par `lib/voiceRecorder.test.ts`). Défini
 * via `vi.hoisted` car `vi.mock` est hissé au-dessus des imports/déclarations.
 */
const { FakeVoiceRecorder } = vi.hoisted(() => {
  class FakeVoiceRecorder {
    static instances: FakeVoiceRecorder[] = [];
    started = false;
    stopped = false;
    canceled = false;
    callbacks: VoiceRecorderCallbacks;
    constructor(callbacks: VoiceRecorderCallbacks) {
      this.callbacks = callbacks;
      FakeVoiceRecorder.instances.push(this);
    }
    start(): Promise<void> {
      this.started = true;
      return Promise.resolve();
    }
    stop(): void {
      this.stopped = true;
    }
    cancel(): void {
      this.canceled = true;
    }
  }
  return { FakeVoiceRecorder };
});

vi.mock('../lib/voiceRecorder', () => ({
  VoiceRecorder: FakeVoiceRecorder,
  voiceFileName: (mime: string) => `voice-message.${mime.includes('ogg') ? 'ogg' : 'webm'}`,
}));

import { api } from '../lib/client';

const shareMock = api.filesShareBytes as unknown as Mock;

/** Dernier enregistreur créé (un par clic sur le micro). */
function dernierEnregistreur(): InstanceType<typeof FakeVoiceRecorder> {
  const instance = FakeVoiceRecorder.instances.at(-1);
  if (instance === undefined) throw new Error('aucun VoiceRecorder créé');
  return instance;
}

beforeEach(() => {
  useUi.setState({ lang: 'fr', toasts: [], modal: null });
  useGroups.setState({ states: {} });
  useFriends.setState({ contacts: [] });
  useSession.setState({ self: null });
  useContextMenu.setState({ menu: null });
  shareMock.mockReset();
  FakeVoiceRecorder.instances = [];
});

function renderInput(onSend = vi.fn(async () => {})) {
  render(<MessageInput placeholder="Écrire à @Alice" onSend={onSend} />);
  return onSend;
}

function addFiles(files: File[]): void {
  fireEvent.change(screen.getByLabelText('Joindre des fichiers', { selector: 'input' }), {
    target: { files },
  });
}

const IMAGE = new File(['ABC'], 'photo.png', { type: 'image/png' });
const PDF = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });

describe('MessageInput — aperçus', () => {
  it('affiche nom et taille du fichier ajouté, vignette data: pour une image', async () => {
    renderInput();
    addFiles([IMAGE, PDF]);

    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(screen.getByText('4 o')).toBeInTheDocument();
    // L'aperçu arrive après lecture du fichier (FileReader asynchrone).
    const vignette = await screen.findByAltText('photo.png');
    expect(vignette.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('retire une pièce de la liste', () => {
    renderInput();
    addFiles([IMAGE]);

    fireEvent.click(screen.getByLabelText('Retirer photo.png'));

    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
  });

  it('ajoute les fichiers collés depuis le presse-papiers', () => {
    renderInput();

    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: { files: [IMAGE] },
    });

    expect(screen.getByText('photo.png')).toBeInTheDocument();
  });
});

describe('MessageInput — bornes', () => {
  it('refuse un fichier au-delà de 8 Mio avec un message clair', () => {
    renderInput();
    const gros = new File([new ArrayBuffer(MAX_TAILLE_PIECE + 1)], 'gros.bin');
    addFiles([gros]);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '« gros.bin » dépasse la limite de 8 Mio',
    );
    expect(screen.queryByText('gros.bin')).not.toBeInTheDocument();
  });

  it('refuse au-delà de 10 pièces par message', () => {
    renderInput();
    const fichiers = Array.from(
      { length: 11 },
      (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' }),
    );
    addFiles(fichiers);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '10 pièces jointes au maximum par message',
    );
    expect(screen.getByText('f9.txt')).toBeInTheDocument();
    expect(screen.queryByText('f10.txt')).not.toBeInTheDocument();
  });
});

describe('MessageInput — envoi', () => {
  it('publie chaque pièce puis envoie le message avec les références', async () => {
    const piece = {
      merkle_root: 'ab'.repeat(32),
      name: 'photo.png',
      size: 3,
      mime: 'image/png',
    };
    shareMock.mockResolvedValueOnce({ file: piece });
    const onSend = renderInput();

    addFiles([IMAGE]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'regarde !' } });
    fireEvent.click(screen.getByLabelText('Envoyer'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('regarde !', [piece]));
    expect(shareMock).toHaveBeenCalledWith('photo.png', 'image/png', 'QUJD');
    // Les aperçus sont vidés après l'envoi.
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
  });

  it('autorise l’envoi sans texte quand il y a des pièces jointes', async () => {
    shareMock.mockResolvedValueOnce({
      file: {
        merkle_root: 'cd'.repeat(32),
        name: 'doc.pdf',
        size: 4,
        mime: 'application/pdf',
      },
    });
    const onSend = renderInput();

    addFiles([PDF]);
    const envoyer = screen.getByLabelText('Envoyer');
    expect(envoyer).toBeEnabled();
    fireEvent.click(envoyer);

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith('', [
        expect.objectContaining({ name: 'doc.pdf' }),
      ]),
    );
  });

  it('interdit l’envoi sans texte ni pièce jointe', () => {
    renderInput();

    expect(screen.getByLabelText('Envoyer')).toBeDisabled();
  });

  it('n’appelle pas files.share_bytes pour un envoi sans pièce', async () => {
    const onSend = renderInput();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bonjour' } });
    fireEvent.click(screen.getByLabelText('Envoyer'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('bonjour', undefined));
    expect(shareMock).not.toHaveBeenCalled();
  });

  it('signale l’échec de publication et conserve la saisie', async () => {
    shareMock.mockRejectedValueOnce(new Error('trop volumineux'));
    const onSend = renderInput();

    addFiles([IMAGE]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'oups' } });
    fireEvent.click(screen.getByLabelText('Envoyer'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Échec de l’envoi'),
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('oups');
    expect(screen.getByText('photo.png')).toBeInTheDocument();
  });
});

/** Installe un groupe (deux membres, un rôle) et un contact nommé « Alice ». */
function setupGroup(): void {
  const state = {
    group_id: 'g1',
    name: 'G',
    icon: null,
    founder: null,
    members: [
      { pubkey: 'pk_alice', roles: [] },
      { pubkey: 'pk_bob', roles: [] },
    ],
    bans: [],
    channels: [],
    categories: [],
    roles: [{ role_id: 'r1', name: 'Mods', color: 0xff0000, position: 1, permissions: 0 }],
    invites: [],
    my_permissions: 0,
  } satisfies GroupStateJson;
  useGroups.setState({ states: { g1: state } });
  useFriends.setState({
    contacts: [{ pubkey: 'pk_alice', display_name: 'Alice' }] as unknown as Contact[],
  });
}

/** Édite la valeur du champ en plaçant le curseur en fin de texte. */
function typeInput(value: string): void {
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value, selectionStart: value.length },
  });
}

describe('MessageInput — autocomplétion de mentions', () => {
  it('ouvre la liste avec membres, rôles et @everyone/@here en salon', () => {
    setupGroup();
    render(<MessageInput placeholder="p" onSend={vi.fn()} groupId="g1" />);

    typeInput('@');

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /@everyone/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /@here/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Mods/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Alice/ })).toBeInTheDocument();
  });

  it('filtre les suggestions au fil de la saisie', () => {
    setupGroup();
    render(<MessageInput placeholder="p" onSend={vi.fn()} groupId="g1" />);

    typeInput('@al');

    expect(screen.getByRole('option', { name: /Alice/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /@everyone/ })).not.toBeInTheDocument();
  });

  it('insère la suggestion à Entrée sans envoyer le message', () => {
    setupGroup();
    const onSend = vi.fn();
    render(<MessageInput placeholder="p" onSend={onSend} groupId="g1" />);

    typeInput('@al');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    expect(screen.getByRole('textbox')).toHaveValue('@Alice ');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('navigue au clavier puis insère avec Tab', () => {
    setupGroup();
    render(<MessageInput placeholder="p" onSend={vi.fn()} groupId="g1" />);

    typeInput('@');
    const box = screen.getByRole('textbox');
    fireEvent.keyDown(box, { key: 'ArrowDown' }); // everyone -> here
    fireEvent.keyDown(box, { key: 'Tab' });

    expect(box).toHaveValue('@here ');
  });

  it('n’ouvre aucune liste en message privé (aucun candidat)', () => {
    render(<MessageInput placeholder="p" onSend={vi.fn()} />);

    typeInput('@');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

/** Profil local minimal pour les scénarios de composeur en salon. */
const SELF = {
  node_id: 'n',
  pubkey: 'moi',
  friend_code: 'accord-moi',
  name: 'Moi',
  bio: null,
  avatar: null,
  banner: null,
  pronouns: null,
  accent_color: null,
  banner_color: null,
};

const GROUP_TARGET = { kind: 'group', groupId: 'g1', channelId: 'c1' } as const;

/** Installe un groupe d'un seul salon `c1` avec le membre local `moi`. */
function seedComposer(over: Partial<GroupStateJson>, channelKind: 'text' | 'announcement'): void {
  useSession.setState({ self: SELF });
  const state = {
    group_id: 'g1',
    name: 'G',
    icon: null,
    founder: null,
    members: [{ pubkey: 'moi', roles: [] }],
    bans: [],
    channels: [
      { channel_id: 'c1', name: 'salon', kind: channelKind, category: null, position: 0, topic: '' },
    ],
    categories: [],
    roles: [],
    invites: [],
    my_permissions: 0x3,
    ...over,
  } satisfies GroupStateJson;
  useGroups.setState({ states: { g1: state } });
}

describe('MessageInput — composeur en lecture seule', () => {
  it('désactive le composeur quand l’utilisateur local est en sourdine', () => {
    seedComposer(
      { members: [{ pubkey: 'moi', roles: [], timeout_until_ms: Date.now() + 60_000 }] },
      'text',
    );
    render(
      <MessageInput
        placeholder="Écrire dans #salon"
        onSend={vi.fn()}
        groupId="g1"
        typingTarget={GROUP_TARGET}
      />,
    );

    expect(screen.getByRole('status').textContent).toMatch(/sourdine/);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('passe un salon d’annonces en lecture seule sans MANAGE_CHANNELS', () => {
    seedComposer({ my_permissions: 0x3 }, 'announcement');
    render(
      <MessageInput
        placeholder="Écrire dans #salon"
        onSend={vi.fn()}
        groupId="g1"
        typingTarget={GROUP_TARGET}
      />,
    );

    expect(screen.getByRole('status').textContent).toMatch(/gestionnaires/);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('laisse écrire dans un salon d’annonces avec MANAGE_CHANNELS', () => {
    seedComposer({ my_permissions: 0x3 | 0x8 }, 'announcement');
    render(
      <MessageInput
        placeholder="Écrire dans #salon"
        onSend={vi.fn()}
        groupId="g1"
        typingTarget={GROUP_TARGET}
      />,
    );

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('MessageInput — message vocal', () => {
  it('démarre l’enregistrement au clic sur le micro : minuteur, textarea désactivée', () => {
    renderInput();

    fireEvent.click(screen.getByLabelText('Enregistrer un message vocal'));

    expect(dernierEnregistreur().started).toBe(true);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('0:00');
    expect(screen.getByLabelText('Annuler l’enregistrement')).toBeInTheDocument();
    expect(screen.getByLabelText('Envoyer le message vocal')).toBeInTheDocument();
    expect(screen.queryByLabelText('Enregistrer un message vocal')).not.toBeInTheDocument();
  });

  it('affiche le temps écoulé au fil des rappels onTick', () => {
    renderInput();
    fireEvent.click(screen.getByLabelText('Enregistrer un message vocal'));

    act(() => dernierEnregistreur().callbacks.onTick(4200));

    expect(screen.getByRole('status')).toHaveTextContent('0:04');
  });

  it('annule au clic sur la corbeille : micro relâché, composeur normal restauré', () => {
    renderInput();
    fireEvent.click(screen.getByLabelText('Enregistrer un message vocal'));
    const enregistreur = dernierEnregistreur();

    fireEvent.click(screen.getByLabelText('Annuler l’enregistrement'));

    expect(enregistreur.canceled).toBe(true);
    expect(screen.getByLabelText('Enregistrer un message vocal')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(shareMock).not.toHaveBeenCalled();
  });

  it('le clic sur la coche appelle stop() (le vrai envoi part de onStop)', () => {
    renderInput();
    fireEvent.click(screen.getByLabelText('Enregistrer un message vocal'));
    const enregistreur = dernierEnregistreur();

    fireEvent.click(screen.getByLabelText('Envoyer le message vocal'));

    expect(enregistreur.stopped).toBe(true);
  });

  it('publie le blob fini via files.share_bytes puis envoie un message avec la pièce audio', async () => {
    const piece = {
      merkle_root: 'ab'.repeat(32),
      name: 'voice-message.webm',
      size: 42,
      mime: 'audio/webm;codecs=opus',
    };
    shareMock.mockResolvedValueOnce({ file: piece });
    const onSend = renderInput();
    fireEvent.click(screen.getByLabelText('Enregistrer un message vocal'));
    const enregistreur = dernierEnregistreur();
    const result: VoiceRecorderResult = {
      blob: new Blob(['son'], { type: 'audio/webm;codecs=opus' }),
      mime: 'audio/webm;codecs=opus',
      durationMs: 3000,
      reason: 'manual',
    };

    await act(async () => enregistreur.callbacks.onStop(result));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('', [piece]));
    expect(shareMock).toHaveBeenCalledWith(
      'voice-message.webm',
      'audio/webm;codecs=opus',
      expect.any(String),
    );
    // Le composeur redevient normal, sans repasser par du texte.
    expect(screen.getByLabelText('Enregistrer un message vocal')).toBeInTheDocument();
  });

  it('signale une limite atteinte (info) quand l’arrêt n’est pas volontaire', async () => {
    shareMock.mockResolvedValueOnce({
      file: {
        merkle_root: 'cd'.repeat(32),
        name: 'voice-message.webm',
        size: 10,
        mime: 'audio/webm',
      },
    });
    renderInput();
    fireEvent.click(screen.getByLabelText('Enregistrer un message vocal'));
    const enregistreur = dernierEnregistreur();

    await act(async () =>
      enregistreur.callbacks.onStop({
        blob: new Blob(['son']),
        mime: 'audio/webm',
        durationMs: 120_000,
        reason: 'max_duration',
      }),
    );

    await waitFor(() =>
      expect(
        useUi.getState().toasts.some((toast) => toast.kind === 'info'),
      ).toBe(true),
    );
  });

  it('permission refusée : toast d’erreur, composeur revient à l’état normal sans planter', () => {
    renderInput();
    fireEvent.click(screen.getByLabelText('Enregistrer un message vocal'));
    const enregistreur = dernierEnregistreur();

    const error: VoiceRecorderError = 'permission_denied';
    act(() => enregistreur.callbacks.onError(error));

    expect(
      useUi
        .getState()
        .toasts.some((toast) => toast.kind === 'error' && /Micro/.test(toast.text)),
    ).toBe(true);
    expect(screen.getByLabelText('Enregistrer un message vocal')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('relâche tout enregistreur en cours au démontage (pas de micro fantôme)', () => {
    const { unmount } = render(
      <MessageInput placeholder="Écrire à @Alice" onSend={vi.fn(async () => {})} />,
    );
    fireEvent.click(screen.getByLabelText('Enregistrer un message vocal'));
    const enregistreur = dernierEnregistreur();

    unmount();

    expect(enregistreur.canceled).toBe(true);
  });
});

describe('MessageInput — menu du trombone (Fichier / Sondage)', () => {
  it('en message privé, ouvre directement le sélecteur de fichiers (aucun menu, aucun sondage)', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    renderInput();

    fireEvent.click(screen.getByLabelText('Joindre des fichiers', { selector: 'button' }));

    expect(clickSpy).toHaveBeenCalled();
    expect(useContextMenu.getState().menu).toBeNull();
    clickSpy.mockRestore();
  });

  it('en salon de groupe, révèle un menu « Fichier » / « Sondage »', () => {
    seedComposer({}, 'text');
    render(
      <MessageInput
        placeholder="Écrire dans #salon"
        onSend={vi.fn()}
        groupId="g1"
        typingTarget={GROUP_TARGET}
      />,
    );

    fireEvent.click(screen.getByLabelText('Joindre des fichiers', { selector: 'button' }));

    const items = useContextMenu.getState().menu?.items ?? [];
    expect(items.map((item) => item.label)).toEqual(['Fichier', 'Sondage']);
  });

  it('« Fichier » du menu ouvre le sélecteur de fichiers', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    seedComposer({}, 'text');
    render(
      <MessageInput
        placeholder="Écrire dans #salon"
        onSend={vi.fn()}
        groupId="g1"
        typingTarget={GROUP_TARGET}
      />,
    );
    fireEvent.click(screen.getByLabelText('Joindre des fichiers', { selector: 'button' }));

    const fileItem = useContextMenu.getState().menu?.items.find((i) => i.label === 'Fichier');
    fileItem?.onClick();

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('« Sondage » du menu ouvre la modale de création réservée au salon courant', () => {
    seedComposer({}, 'text');
    render(
      <MessageInput
        placeholder="Écrire dans #salon"
        onSend={vi.fn()}
        groupId="g1"
        typingTarget={GROUP_TARGET}
      />,
    );
    fireEvent.click(screen.getByLabelText('Joindre des fichiers', { selector: 'button' }));

    const pollItem = useContextMenu.getState().menu?.items.find((i) => i.label === 'Sondage');
    pollItem?.onClick();

    expect(useUi.getState().modal).toEqual({
      kind: 'createPoll',
      groupId: 'g1',
      channelId: 'c1',
    });
  });
});
