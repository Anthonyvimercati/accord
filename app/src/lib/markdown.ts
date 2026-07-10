/**
 * Markdown léger PUR (aucun React, aucune manipulation du DOM) : transforme le
 * texte d'un message en un arbre de nœuds de données que `components/MarkdownText`
 * rend sans jamais injecter de HTML. Un seul passage compose émojis custom,
 * mise en forme et mentions.
 *
 * Constructions gérées :
 * - gras `**…**`, italique `*…*` ou `_…_`, barré `~~…~~`, spoiler `||…||` ;
 * - code inline `` `…` `` et bloc de code ```` ```…``` ```` (contenu littéral,
 *   aucune sous-mise-en-forme) ;
 * - liens automatiques `http(s)://…` (schéma restreint, sûrs au rendu) ;
 * - mentions `@pseudo` et émojis custom `:name:` ;
 * - échappement par `\` et sauts de ligne.
 */

/** Nœud de l'arbre markdown (données pures, sérialisables). */
export type MdNode =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'bold'; readonly children: MdNode[] }
  | { readonly type: 'italic'; readonly children: MdNode[] }
  | { readonly type: 'strike'; readonly children: MdNode[] }
  | { readonly type: 'spoiler'; readonly children: MdNode[] }
  | { readonly type: 'code'; readonly value: string }
  | { readonly type: 'codeblock'; readonly value: string }
  | { readonly type: 'link'; readonly href: string; readonly value: string }
  | { readonly type: 'mention'; readonly name: string }
  | { readonly type: 'emoji'; readonly name: string }
  | { readonly type: 'break' };

/** Profondeur maximale d'imbrication (garde anti-récursion pathologique). */
const MAX_DEPTH = 8;

/** Vrai si `c` n'est pas un caractère de mot (lettre ou chiffre Unicode). */
function estBord(c: string | undefined): boolean {
  return c === undefined || !/[\p{L}\p{N}]/u.test(c);
}

/**
 * Position de la prochaine occurrence non échappée de `delim` à partir de
 * `start`, ou `-1`. Les délimiteurs précédés de `\` sont ignorés.
 */
function trouverFermeture(src: string, delim: string, start: number): number {
  let i = start;
  while (i <= src.length - delim.length) {
    if (src[i] === '\\') {
      i += 2;
      continue;
    }
    if (src.startsWith(delim, i)) return i;
    i += 1;
  }
  return -1;
}

/** Retire un unique saut de ligne de tête et de fin d'un bloc de code. */
function contenuBloc(inner: string): string {
  return inner.replace(/^\n/, '').replace(/\n$/, '');
}

/** Lit une URL http(s) à partir de `i`, ponctuation de fin exclue, ou `null`. */
function lireLien(src: string, i: number): string | null {
  let j = i;
  while (j < src.length && !/\s/.test(src[j] ?? '') && src[j] !== '<' && src[j] !== '>') {
    j += 1;
  }
  const url = src.slice(i, j).replace(/[.,;:!?)\]}'"]+$/, '');
  return /^https?:\/\/\S/.test(url) ? url : null;
}

/** Analyse récursive d'un fragment en nœuds inline. */
function analyserFragment(src: string, depth: number): MdNode[] {
  const nodes: MdNode[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf !== '') {
      nodes.push({ type: 'text', value: buf });
      buf = '';
    }
  };
  const enveloppe = (
    type: 'bold' | 'italic' | 'strike' | 'spoiler',
    inner: string,
  ): void => {
    flush();
    nodes.push({ type, children: analyserFragment(inner, depth + 1) });
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i] ?? '';

    // Échappement : le caractère suivant est littéral.
    if (c === '\\' && i + 1 < n) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    // Bloc de code ```…``` (contenu littéral, sauts de ligne compris).
    if (src.startsWith('```', i)) {
      const end = src.indexOf('```', i + 3);
      if (end !== -1) {
        flush();
        nodes.push({ type: 'codeblock', value: contenuBloc(src.slice(i + 3, end)) });
        i = end + 3;
        continue;
      }
    }

    // Code inline `…` (contenu littéral).
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        nodes.push({ type: 'code', value: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (depth < MAX_DEPTH) {
      // Spoiler ||…||.
      if (src.startsWith('||', i)) {
        const end = trouverFermeture(src, '||', i + 2);
        if (end > i + 2) {
          enveloppe('spoiler', src.slice(i + 2, end));
          i = end + 2;
          continue;
        }
      }
      // Gras **…**.
      if (src.startsWith('**', i)) {
        const end = trouverFermeture(src, '**', i + 2);
        if (end > i + 2) {
          enveloppe('bold', src.slice(i + 2, end));
          i = end + 2;
          continue;
        }
      }
      // Barré ~~…~~.
      if (src.startsWith('~~', i)) {
        const end = trouverFermeture(src, '~~', i + 2);
        if (end > i + 2) {
          enveloppe('strike', src.slice(i + 2, end));
          i = end + 2;
          continue;
        }
      }
      // Italique *…*.
      if (c === '*') {
        const end = trouverFermeture(src, '*', i + 1);
        if (end > i + 1) {
          enveloppe('italic', src.slice(i + 1, end));
          i = end + 1;
          continue;
        }
      }
      // Italique _…_ (garde de limite de mot : `snake_case` reste littéral).
      if (c === '_' && estBord(src[i - 1])) {
        const end = trouverFermeture(src, '_', i + 1);
        if (end > i + 1 && estBord(src[end + 1])) {
          enveloppe('italic', src.slice(i + 1, end));
          i = end + 1;
          continue;
        }
      }
    }

    // Lien automatique http(s)://….
    if (src.startsWith('http://', i) || src.startsWith('https://', i)) {
      const lien = lireLien(src, i);
      if (lien !== null) {
        flush();
        nodes.push({ type: 'link', href: lien, value: lien });
        i += lien.length;
        continue;
      }
    }

    // Mention @pseudo.
    if (c === '@') {
      const m = /^@([\p{L}\p{N}_-]{1,32})/u.exec(src.slice(i));
      if (m?.[1] !== undefined) {
        flush();
        nodes.push({ type: 'mention', name: m[1] });
        i += m[0].length;
        continue;
      }
    }

    // Émoji custom :name:.
    if (c === ':') {
      const m = /^:([a-z0-9_]{2,32}):/.exec(src.slice(i));
      if (m?.[1] !== undefined) {
        flush();
        nodes.push({ type: 'emoji', name: m[1] });
        i += m[0].length;
        continue;
      }
    }

    // Saut de ligne.
    if (c === '\n') {
      flush();
      nodes.push({ type: 'break' });
      i += 1;
      continue;
    }

    buf += c;
    i += 1;
  }

  flush();
  return nodes;
}

/** Transforme un texte de message en arbre markdown (fonction pure). */
export function analyserMarkdown(texte: string): MdNode[] {
  return analyserFragment(texte, 0);
}
