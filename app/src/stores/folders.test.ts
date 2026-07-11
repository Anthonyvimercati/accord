/**
 * Tests des transformations pures des dossiers de serveurs : création,
 * renommage, rangement/retrait de serveurs (appartenance unique), pli/dépli,
 * suppression (retour à la racine) et validation du JSON persisté.
 */

import { describe, expect, it } from 'vitest';
import {
  addServerToFolder,
  createFolder,
  deleteFolder,
  folderOfServer,
  parseFolders,
  removeServerFromFolders,
  renameFolder,
  toggleFolderCollapsed,
  type ServerFolder,
} from './folders';

function folder(id: string, serverIds: string[] = [], collapsed = false): ServerFolder {
  return { id, name: `Dossier ${id}`, serverIds, collapsed };
}

describe('createFolder', () => {
  it('ajoute un dossier déplié en fin de liste, sans muter l’original', () => {
    const before = [folder('f1')];

    const after = createFolder(before, 'f2', 'Jeux', ['g1']);

    expect(after).toHaveLength(2);
    expect(after[1]).toEqual({
      id: 'f2',
      name: 'Jeux',
      serverIds: ['g1'],
      collapsed: false,
    });
    expect(before).toHaveLength(1);
  });

  it('retire les serveurs fournis de leurs anciens dossiers (appartenance unique)', () => {
    const before = [folder('f1', ['g1', 'g2'])];

    const after = createFolder(before, 'f2', 'Jeux', ['g1']);

    expect(after[0]?.serverIds).toEqual(['g2']);
    expect(after[1]?.serverIds).toEqual(['g1']);
  });
});

describe('renameFolder', () => {
  it('renomme le dossier ciblé sans toucher aux autres', () => {
    const before = [folder('f1'), folder('f2')];

    const after = renameFolder(before, 'f2', 'Travail');

    expect(after[0]?.name).toBe('Dossier f1');
    expect(after[1]?.name).toBe('Travail');
  });

  it('ignore un nom vide', () => {
    const after = renameFolder([folder('f1')], 'f1', '');

    expect(after[0]?.name).toBe('Dossier f1');
  });
});

describe('addServerToFolder', () => {
  it('range le serveur dans le dossier ciblé', () => {
    const after = addServerToFolder([folder('f1', ['g1'])], 'f1', 'g2');

    expect(after[0]?.serverIds).toEqual(['g1', 'g2']);
  });

  it('déplace le serveur depuis son ancien dossier (appartenance unique)', () => {
    const before = [folder('f1', ['g1']), folder('f2')];

    const after = addServerToFolder(before, 'f2', 'g1');

    expect(after[0]?.serverIds).toEqual([]);
    expect(after[1]?.serverIds).toEqual(['g1']);
  });

  it('reste sans effet si le dossier n’existe pas', () => {
    const before = [folder('f1', ['g1'])];

    const after = addServerToFolder(before, 'f-disparu', 'g1');

    expect(after).toEqual(before);
  });
});

describe('removeServerFromFolders', () => {
  it('retire le serveur du dossier qui le contient', () => {
    const after = removeServerFromFolders([folder('f1', ['g1', 'g2'])], 'g1');

    expect(after[0]?.serverIds).toEqual(['g2']);
  });

  it('reste sans effet pour un serveur déjà à la racine', () => {
    const before = [folder('f1', ['g1'])];

    const after = removeServerFromFolders(before, 'g-racine');

    expect(after).toEqual(before);
  });
});

describe('toggleFolderCollapsed', () => {
  it('plie puis déplie le dossier ciblé', () => {
    const plié = toggleFolderCollapsed([folder('f1')], 'f1');
    expect(plié[0]?.collapsed).toBe(true);

    const déplié = toggleFolderCollapsed(plié, 'f1');
    expect(déplié[0]?.collapsed).toBe(false);
  });
});

describe('deleteFolder', () => {
  it('supprime le dossier — ses serveurs ne sont plus rangés (retour racine)', () => {
    const before = [folder('f1', ['g1']), folder('f2', ['g2'])];

    const after = deleteFolder(before, 'f1');

    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe('f2');
    expect(folderOfServer(after, 'g1')).toBeNull();
  });
});

describe('folderOfServer', () => {
  it('retrouve le dossier d’un serveur rangé, null sinon', () => {
    const folders = [folder('f1', ['g1'])];

    expect(folderOfServer(folders, 'g1')?.id).toBe('f1');
    expect(folderOfServer(folders, 'g2')).toBeNull();
  });
});

describe('parseFolders', () => {
  it('relit une liste valide (avec ou sans couleur)', () => {
    const raw = JSON.stringify([
      { id: 'f1', name: 'Jeux', serverIds: ['g1'], collapsed: true, color: '#f00' },
      { id: 'f2', name: 'Travail', serverIds: [], collapsed: false },
    ]);

    const folders = parseFolders(raw);

    expect(folders).toHaveLength(2);
    expect(folders[0]?.color).toBe('#f00');
    expect(folders[1]?.collapsed).toBe(false);
  });

  it('replie sur une liste vide : absent, JSON invalide ou forme inattendue', () => {
    expect(parseFolders(null)).toEqual([]);
    expect(parseFolders('{pas du json')).toEqual([]);
    expect(parseFolders('{"id":"f1"}')).toEqual([]);
    expect(parseFolders(JSON.stringify([{ id: 'f1' }]))).toEqual([]);
    expect(
      parseFolders(
        JSON.stringify([{ id: 'f1', name: 'x', serverIds: [42], collapsed: false }]),
      ),
    ).toEqual([]);
  });
});
