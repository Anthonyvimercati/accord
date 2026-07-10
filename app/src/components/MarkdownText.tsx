/**
 * Rendu sûr du markdown léger : consomme l'arbre pur de `lib/markdown` et
 * produit des nœuds React (aucun `dangerouslySetInnerHTML` — React échappe le
 * texte). Compose émojis custom `:name:`, mentions `@pseudo` (surlignées, en
 * « pill » pour un membre connu) et mise en forme dans un même passage.
 */

import { Fragment, useState, type ReactNode } from 'react';
import { analyserMarkdown, type MdNode } from '../lib/markdown';
import { useT } from '../stores/ui';
import { CustomEmoji } from './CustomEmoji';

export interface MarkdownTextProps {
  text: string;
  /** Émojis du serveur (nom → racine Merkle) pour rendre `:name:` en image. */
  emojis?: ReadonlyMap<string, string> | undefined;
  /** Noms connus (en minuscules) rendus en « pill » de mention. */
  knownMentions?: ReadonlySet<string> | undefined;
  /** Pair source probable pour le téléchargement des images d'émoji. */
  hint?: string | undefined;
}

/** Contexte de rendu passé récursivement aux nœuds. */
interface Ctx {
  emojis?: ReadonlyMap<string, string> | undefined;
  knownMentions?: ReadonlySet<string> | undefined;
  hint?: string | undefined;
}

/** N'accepte que les schémas http/https (les autres sont rendus en texte). */
function lienSur(url: string): string | undefined {
  try {
    const p = new URL(url);
    if (p.protocol === 'http:' || p.protocol === 'https:') return url;
  } catch {
    // URL non analysable : traitée comme du texte par l'appelant.
  }
  return undefined;
}

/** Spoiler : contenu masqué révélé au clic ou au clavier (Entrée/Espace). */
function Spoiler({ children }: { children: ReactNode }) {
  const t = useT();
  const [revele, setRevele] = useState(false);
  if (revele) {
    return <span className="rounded bg-input/70 px-0.5">{children}</span>;
  }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t.emoji.spoilerReveal}
      onClick={() => setRevele(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setRevele(true);
        }
      }}
      className="cursor-pointer select-none rounded bg-faint/60 px-0.5 text-transparent transition-colors hover:bg-faint/70"
    >
      {children}
    </span>
  );
}

function renderNodes(nodes: readonly MdNode[], ctx: Ctx): ReactNode {
  return nodes.map((node, i) => <Fragment key={i}>{renderNode(node, ctx)}</Fragment>);
}

function renderNode(node: MdNode, ctx: Ctx): ReactNode {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'break':
      return <br />;
    case 'bold':
      return <strong className="font-semibold">{renderNodes(node.children, ctx)}</strong>;
    case 'italic':
      return <em>{renderNodes(node.children, ctx)}</em>;
    case 'strike':
      return <s>{renderNodes(node.children, ctx)}</s>;
    case 'spoiler':
      return <Spoiler>{renderNodes(node.children, ctx)}</Spoiler>;
    case 'code':
      return (
        <code className="rounded bg-rail px-1 py-0.5 font-mono text-[0.85em] text-norm">
          {node.value}
        </code>
      );
    case 'codeblock':
      return (
        <pre className="my-1 overflow-x-auto rounded-md bg-rail p-2 font-mono text-[0.85em] text-norm">
          <code>{node.value}</code>
        </pre>
      );
    case 'link': {
      const href = lienSur(node.href);
      if (href === undefined) return node.value;
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link hover:underline"
        >
          {node.value}
        </a>
      );
    }
    case 'mention': {
      const connu = ctx.knownMentions?.has(node.name.toLowerCase()) ?? false;
      return (
        <span
          className={
            connu
              ? 'rounded bg-blurple/20 px-0.5 font-medium text-blurple'
              : 'font-medium text-blurple'
          }
        >
          @{node.name}
        </span>
      );
    }
    case 'emoji': {
      const merkle = ctx.emojis?.get(node.name);
      if (merkle === undefined) return `:${node.name}:`;
      return <CustomEmoji name={node.name} merkleRoot={merkle} hint={ctx.hint} />;
    }
  }
}

/** Rend un texte de message en nœuds React (markdown + émojis + mentions). */
export function MarkdownText({ text, emojis, knownMentions, hint }: MarkdownTextProps) {
  const nodes = analyserMarkdown(text);
  return <>{renderNodes(nodes, { emojis, knownMentions, hint })}</>;
}
