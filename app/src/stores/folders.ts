/**
 * Dossiers de serveurs (façon Discord) : regroupement purement local des
 * icônes du rail, persisté dans localStorage (clé `accord.serverFolders`) —
 * aucun effet réseau. Les transformations sont des fonctions pures exportées
 * (testées isolément) ; le store zustand ne fait que les appliquer puis
 * persister le résultat.
 */

import { create } from 'zustand';

export interface ServerFolder {
  id: string;
  name: string;
  /** Teinte d'accent optionnelle (non éditable pour l'instant). */
  color?: string;
  serverIds: string[];
  collapsed: boolean;
}

const STORAGE_KEY = 'accord.serverFolders';

/** Lecture localStorage tolérante (stockage indisponible → null). */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Écriture localStorage tolérante (état non persisté en cas d'échec). */
function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best effort : les dossiers restent appliqués pour la session en cours.
  }
}

/**
 * Validation à la frontière : une entrée persistée malformée (JSON invalide,
 * champ manquant, mauvais type) replie sur « aucun dossier » plutôt que de
 * propager des données corrompues dans l'interface.
 */
export function parseFolders(raw: string | null): ServerFolder[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const folders: ServerFolder[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return [];
    const f = entry as Record<string, unknown>;
    if (typeof f.id !== 'string' || typeof f.name !== 'string') return [];
    if (typeof f.collapsed !== 'boolean' || !Array.isArray(f.serverIds)) return [];
    if (!f.serverIds.every((s): s is string => typeof s === 'string')) return [];
    const folder: ServerFolder = {
      id: f.id,
      name: f.name,
      serverIds: f.serverIds,
      collapsed: f.collapsed,
    };
    if (typeof f.color === 'string') folder.color = f.color;
    folders.push(folder);
  }
  return folders;
}

/* Transformations pures : chacune renvoie une nouvelle liste, sans muter. */

/** Ajoute un dossier en fin de liste. */
export function createFolder(
  folders: readonly ServerFolder[],
  id: string,
  name: string,
  serverIds: readonly string[] = [],
): ServerFolder[] {
  // Un serveur appartient à un dossier au plus : retiré des autres d'abord.
  const cleaned = serverIds.reduce(removeServerFromFolders, [...folders]);
  return [...cleaned, { id, name, serverIds: [...serverIds], collapsed: false }];
}

/** Renomme un dossier (nom vide ignoré). */
export function renameFolder(
  folders: readonly ServerFolder[],
  folderId: string,
  name: string,
): ServerFolder[] {
  if (name === '') return [...folders];
  return folders.map((f) => (f.id === folderId ? { ...f, name } : f));
}

/**
 * Range un serveur dans un dossier — en le retirant d'abord de tout autre
 * dossier (appartenance unique). Sans effet si le dossier n'existe pas.
 */
export function addServerToFolder(
  folders: readonly ServerFolder[],
  folderId: string,
  serverId: string,
): ServerFolder[] {
  if (!folders.some((f) => f.id === folderId)) return [...folders];
  return removeServerFromFolders(folders, serverId).map((f) =>
    f.id === folderId ? { ...f, serverIds: [...f.serverIds, serverId] } : f,
  );
}

/** Retire un serveur de tout dossier (il revient à la racine du rail). */
export function removeServerFromFolders(
  folders: readonly ServerFolder[],
  serverId: string,
): ServerFolder[] {
  return folders.map((f) =>
    f.serverIds.includes(serverId)
      ? { ...f, serverIds: f.serverIds.filter((s) => s !== serverId) }
      : f,
  );
}

/** Plie/déplie un dossier. */
export function toggleFolderCollapsed(
  folders: readonly ServerFolder[],
  folderId: string,
): ServerFolder[] {
  return folders.map((f) => (f.id === folderId ? { ...f, collapsed: !f.collapsed } : f));
}

/** Supprime un dossier — ses serveurs retournent à la racine du rail. */
export function deleteFolder(
  folders: readonly ServerFolder[],
  folderId: string,
): ServerFolder[] {
  return folders.filter((f) => f.id !== folderId);
}

/** Dossier contenant `serverId`, ou `null` s'il est à la racine. */
export function folderOfServer(
  folders: readonly ServerFolder[],
  serverId: string,
): ServerFolder | null {
  return folders.find((f) => f.serverIds.includes(serverId)) ?? null;
}

/** Identifiant local unique (pas de besoin cryptographique ici). */
function newFolderId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

interface FoldersState {
  folders: ServerFolder[];
  /** Crée un dossier (avec ses premiers serveurs) et renvoie son id. */
  createFolder: (name: string, serverIds?: string[]) => string;
  renameFolder: (folderId: string, name: string) => void;
  addServer: (folderId: string, serverId: string) => void;
  removeServer: (serverId: string) => void;
  toggleCollapsed: (folderId: string) => void;
  deleteFolder: (folderId: string) => void;
}

export const useFolders = create<FoldersState>((set) => {
  const apply = (next: ServerFolder[]): { folders: ServerFolder[] } => {
    writeStored(STORAGE_KEY, JSON.stringify(next));
    return { folders: next };
  };

  return {
    folders: parseFolders(readStored(STORAGE_KEY)),

    createFolder: (name, serverIds = []) => {
      const id = newFolderId();
      set((s) => apply(createFolder(s.folders, id, name, serverIds)));
      return id;
    },
    renameFolder: (folderId, name) =>
      set((s) => apply(renameFolder(s.folders, folderId, name))),
    addServer: (folderId, serverId) =>
      set((s) => apply(addServerToFolder(s.folders, folderId, serverId))),
    removeServer: (serverId) =>
      set((s) => apply(removeServerFromFolders(s.folders, serverId))),
    toggleCollapsed: (folderId) =>
      set((s) => apply(toggleFolderCollapsed(s.folders, folderId))),
    deleteFolder: (folderId) =>
      set((s) => apply(deleteFolder(s.folders, folderId))),
  };
});
