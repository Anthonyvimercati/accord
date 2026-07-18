/**
 * Glisser-déposer de fichiers dans la conversation (D-053).
 *
 * Deux mondes très différents sous une même interface :
 * - **app Tauri** : la webview intercepte les dépôts de fichiers de l'OS
 *   (les événements DOM `drop` n'exposent jamais les fichiers) — on écoute
 *   `onDragDropEvent`, qui livre des CHEMINS disque : publication par
 *   `files.share`, sans plafond de taille (comme le sélecteur natif) ;
 * - **navigateur (dev)** : événements DOM standards, objets `File` en
 *   mémoire (chemin `files.share_bytes`, plafonné à 8 Mio).
 *
 * Le survol est signalé (`glisse`) pour afficher un voile « Déposez pour
 * envoyer » ; l'écoute couvre toute la fenêtre — comme Discord, on peut
 * lâcher n'importe où dans la conversation.
 */

import { useEffect, useRef, useState } from 'react';
import { isTauri } from '../lib/bridge';

interface Options {
  /** Faux : survol et dépôts ignorés (envoi en cours, saisie désactivée). */
  actif: boolean;
  /** Fichiers en mémoire déposés (navigateur). */
  surFichiers: (fichiers: File[]) => void;
  /** Chemins disque déposés (app Tauri). */
  surChemins: (chemins: string[]) => void;
}

/** Vrai si le glisser en cours transporte des fichiers (pas du texte). */
function contientFichiers(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

export function useDeposeFichiers({ actif, surFichiers, surChemins }: Options): {
  glisse: boolean;
} {
  const [glisse, setGlisse] = useState(false);
  // Callbacks lus via une ref : l'abonnement (Tauri comme DOM) est posé une
  // seule fois, sans se réabonner à chaque rendu.
  const cbRef = useRef({ actif, surFichiers, surChemins });
  cbRef.current = { actif, surFichiers, surChemins };

  useEffect(() => {
    if (isTauri()) {
      let alive = true;
      let off: (() => void) | null = null;
      void (async () => {
        try {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const un = await getCurrentWebview().onDragDropEvent((event) => {
            if (!cbRef.current.actif) {
              setGlisse(false);
              return;
            }
            const charge = event.payload;
            if (charge.type === 'enter' || charge.type === 'over') {
              setGlisse(true);
            } else if (charge.type === 'leave') {
              setGlisse(false);
            } else if (charge.type === 'drop') {
              setGlisse(false);
              if (charge.paths.length > 0) {
                cbRef.current.surChemins(charge.paths);
              }
            }
          });
          if (alive) {
            off = un;
          } else {
            un();
          }
        } catch {
          // Hors webview Tauri réelle : pas de glisser-déposer natif.
        }
      })();
      return () => {
        alive = false;
        off?.();
      };
    }

    // Navigateur : `dragenter`/`dragleave` s'imbriquent à chaque élément
    // traversé — un compteur de profondeur évite le clignotement du voile.
    let profondeur = 0;
    const surEnter = (e: DragEvent): void => {
      if (!contientFichiers(e) || !cbRef.current.actif) return;
      profondeur += 1;
      setGlisse(true);
    };
    const surOver = (e: DragEvent): void => {
      // Sans preventDefault, le navigateur refuse le dépôt (et ouvrirait le
      // fichier à la place).
      if (contientFichiers(e)) e.preventDefault();
    };
    const surLeave = (): void => {
      profondeur = Math.max(0, profondeur - 1);
      if (profondeur === 0) setGlisse(false);
    };
    const surDrop = (e: DragEvent): void => {
      if (!contientFichiers(e)) return;
      e.preventDefault();
      profondeur = 0;
      setGlisse(false);
      const fichiers = Array.from(e.dataTransfer?.files ?? []);
      if (fichiers.length > 0 && cbRef.current.actif) {
        cbRef.current.surFichiers(fichiers);
      }
    };
    window.addEventListener('dragenter', surEnter);
    window.addEventListener('dragover', surOver);
    window.addEventListener('dragleave', surLeave);
    window.addEventListener('drop', surDrop);
    return () => {
      window.removeEventListener('dragenter', surEnter);
      window.removeEventListener('dragover', surOver);
      window.removeEventListener('dragleave', surLeave);
      window.removeEventListener('drop', surDrop);
    };
  }, []);

  return { glisse };
}
