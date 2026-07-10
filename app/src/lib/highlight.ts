/**
 * Zero-dependency syntax highlighter for fenced code blocks. Produces a flat
 * list of pure data tokens (keyword / string / comment / number / plain)
 * whose values concatenate back to the exact input, so the renderer can emit
 * React nodes only — no HTML string is ever produced here (XSS-safe).
 *
 * Fidelity is intentionally Discord-level: keywords, strings, comments and
 * numbers per language. Unknown languages return `null` and the caller
 * renders the block as plain text.
 */

export type TokenKind = 'keyword' | 'string' | 'comment' | 'number' | 'plain';

export interface CodeToken {
  readonly kind: TokenKind;
  readonly value: string;
}

/** Internal language definition consumed by the generic tokenizer. */
interface LangDef {
  readonly keywords: ReadonlySet<string>;
  readonly lineComments: readonly string[];
  readonly blockComments: readonly (readonly [string, string])[];
  /** Single-line string delimiters (an unterminated string stops at `\n`). */
  readonly stringDelims: readonly string[];
  /** Multi-line string delimiters (JS backtick, Python triple quotes). */
  readonly multilineStringDelims: readonly string[];
  /** Extra characters allowed inside identifiers (e.g. `-` in CSS/HTML). */
  readonly identExtra: string;
  /** HTML mode: an identifier right after `<` or `</` is a tag keyword. */
  readonly tagNames: boolean;
  /** CSS mode: identifiers followed by `:` and `@`-rules are keywords. */
  readonly propNames: boolean;
}

interface LangSpec {
  readonly keywords?: readonly string[];
  readonly lineComments?: readonly string[];
  readonly blockComments?: readonly (readonly [string, string])[];
  readonly stringDelims?: readonly string[];
  readonly multilineStringDelims?: readonly string[];
  readonly identExtra?: string;
  readonly tagNames?: boolean;
  readonly propNames?: boolean;
}

function defineLang(spec: LangSpec): LangDef {
  return {
    keywords: new Set(spec.keywords ?? []),
    lineComments: spec.lineComments ?? [],
    blockComments: spec.blockComments ?? [],
    stringDelims: spec.stringDelims ?? [],
    multilineStringDelims: spec.multilineStringDelims ?? [],
    identExtra: spec.identExtra ?? '',
    tagNames: spec.tagNames ?? false,
    propNames: spec.propNames ?? false,
  };
}

const JS_TS = defineLang({
  keywords: [
    'abstract',
    'any',
    'as',
    'async',
    'await',
    'boolean',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'declare',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'from',
    'function',
    'get',
    'if',
    'implements',
    'import',
    'in',
    'infer',
    'instanceof',
    'interface',
    'is',
    'keyof',
    'let',
    'namespace',
    'never',
    'new',
    'null',
    'number',
    'object',
    'of',
    'private',
    'protected',
    'public',
    'readonly',
    'return',
    'satisfies',
    'set',
    'static',
    'string',
    'super',
    'switch',
    'symbol',
    'this',
    'throw',
    'true',
    'try',
    'type',
    'typeof',
    'undefined',
    'unknown',
    'var',
    'void',
    'while',
    'with',
    'yield',
  ],
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  stringDelims: ['"', "'"],
  multilineStringDelims: ['`'],
});

const PYTHON = defineLang({
  keywords: [
    'and',
    'as',
    'assert',
    'async',
    'await',
    'break',
    'case',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'else',
    'except',
    'False',
    'finally',
    'for',
    'from',
    'global',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'match',
    'None',
    'nonlocal',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'self',
    'True',
    'try',
    'while',
    'with',
    'yield',
  ],
  lineComments: ['#'],
  stringDelims: ['"', "'"],
  multilineStringDelims: ['"""', "'''"],
});

const RUST = defineLang({
  keywords: [
    'as',
    'async',
    'await',
    'break',
    'const',
    'continue',
    'crate',
    'dyn',
    'else',
    'enum',
    'extern',
    'false',
    'fn',
    'for',
    'if',
    'impl',
    'in',
    'let',
    'loop',
    'match',
    'mod',
    'move',
    'mut',
    'pub',
    'ref',
    'return',
    'self',
    'Self',
    'static',
    'struct',
    'super',
    'trait',
    'true',
    'type',
    'union',
    'unsafe',
    'use',
    'where',
    'while',
  ],
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  stringDelims: ['"'],
});

const JSON_LANG = defineLang({
  keywords: ['true', 'false', 'null'],
  stringDelims: ['"'],
});

const BASH = defineLang({
  keywords: [
    'break',
    'case',
    'cd',
    'continue',
    'declare',
    'do',
    'done',
    'echo',
    'elif',
    'else',
    'esac',
    'eval',
    'exec',
    'exit',
    'export',
    'false',
    'fi',
    'for',
    'function',
    'if',
    'in',
    'local',
    'readonly',
    'return',
    'select',
    'set',
    'shift',
    'source',
    'then',
    'trap',
    'true',
    'unset',
    'until',
    'while',
  ],
  lineComments: ['#'],
  stringDelims: ['"', "'"],
});

const HTML = defineLang({
  blockComments: [['<!--', '-->']],
  stringDelims: ['"', "'"],
  identExtra: '-',
  tagNames: true,
});

const CSS = defineLang({
  blockComments: [['/*', '*/']],
  stringDelims: ['"', "'"],
  identExtra: '-',
  propNames: true,
});

function withAliases(names: readonly string[], def: LangDef): [string, LangDef][] {
  return names.map((name) => [name, def]);
}

const LANGS: ReadonlyMap<string, LangDef> = new Map([
  ...withAliases(
    ['js', 'jsx', 'javascript', 'ts', 'tsx', 'typescript', 'mjs', 'cjs'],
    JS_TS,
  ),
  ...withAliases(['py', 'python', 'python3'], PYTHON),
  ...withAliases(['rs', 'rust'], RUST),
  ...withAliases(['json', 'jsonc'], JSON_LANG),
  ...withAliases(['sh', 'bash', 'shell', 'zsh'], BASH),
  ...withAliases(['html', 'htm', 'xml', 'svg'], HTML),
  ...withAliases(['css'], CSS),
]);

/** Integer/float/hex/binary/octal literals (underscore separators allowed). */
const NUMBER_RE =
  /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9]+)?)/;

/**
 * Scans a string literal starting at `start` (which points at the opening
 * delimiter). Returns the index just past the closing delimiter, or the end
 * of the line/input for unterminated strings (graceful degradation).
 */
function scanString(
  code: string,
  start: number,
  delim: string,
  multiline: boolean,
): number {
  let i = start + delim.length;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (code.startsWith(delim, i)) return i + delim.length;
    if (!multiline && c === '\n') return i;
    i += 1;
  }
  return n;
}

/** True when the identifier at `start` directly follows `<` or `</` (a tag). */
function isTagPosition(code: string, start: number): boolean {
  let k = start - 1;
  if (code[k] === '/') k -= 1;
  return code[k] === '<';
}

/** First non-blank character (space/tab skipped) at or after `from`. */
function nextNonBlank(code: string, from: number): string {
  let k = from;
  while (k < code.length && (code[k] === ' ' || code[k] === '\t')) k += 1;
  return code[k] ?? '';
}

function tokenize(code: string, def: LangDef): CodeToken[] {
  const tokens: CodeToken[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain !== '') {
      tokens.push({ kind: 'plain', value: plain });
      plain = '';
    }
  };
  const push = (kind: TokenKind, value: string): void => {
    flush();
    tokens.push({ kind, value });
  };
  const isIdentStart = (c: string): boolean =>
    /[A-Za-z_$]/.test(c) || def.identExtra.includes(c);
  const isIdentCont = (c: string): boolean =>
    /[A-Za-z0-9_$]/.test(c) || def.identExtra.includes(c);

  let i = 0;
  const n = code.length;
  while (i < n) {
    const lineComment = def.lineComments.find((m) => code.startsWith(m, i));
    if (lineComment !== undefined) {
      const nl = code.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      push('comment', code.slice(i, end));
      i = end;
      continue;
    }

    const blockComment = def.blockComments.find((pair) => code.startsWith(pair[0], i));
    if (blockComment !== undefined) {
      const close = code.indexOf(blockComment[1], i + blockComment[0].length);
      const end = close === -1 ? n : close + blockComment[1].length;
      push('comment', code.slice(i, end));
      i = end;
      continue;
    }

    // Multi-line delimiters first: `'''` must win over `'`.
    const multiDelim = def.multilineStringDelims.find((d) => code.startsWith(d, i));
    if (multiDelim !== undefined) {
      const end = scanString(code, i, multiDelim, true);
      push('string', code.slice(i, end));
      i = end;
      continue;
    }

    const strDelim = def.stringDelims.find((d) => code.startsWith(d, i));
    if (strDelim !== undefined) {
      const end = scanString(code, i, strDelim, false);
      push('string', code.slice(i, end));
      i = end;
      continue;
    }

    const c = code[i] ?? '';

    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentCont(code[j] ?? '')) j += 1;
      const word = code.slice(i, j);
      const isTag = def.tagNames && isTagPosition(code, i);
      const isProp = def.propNames && nextNonBlank(code, j) === ':';
      if (def.keywords.has(word) || isTag || isProp) push('keyword', word);
      else plain += word;
      i = j;
      continue;
    }

    if (c >= '0' && c <= '9') {
      const m = NUMBER_RE.exec(code.slice(i));
      if (m !== null) {
        push('number', m[0]);
        i += m[0].length;
        continue;
      }
    }

    // CSS at-rules (@media, @keyframes, …).
    if (def.propNames && c === '@') {
      let j = i + 1;
      while (j < n && isIdentCont(code[j] ?? '')) j += 1;
      if (j > i + 1) {
        push('keyword', code.slice(i, j));
        i = j;
        continue;
      }
    }

    plain += c;
    i += 1;
  }

  flush();
  return tokens;
}

/**
 * Tokenizes `code` for the given fence language tag. Returns `null` when the
 * language is unknown (caller renders plain text). The concatenation of the
 * returned token values is always exactly `code`.
 */
export function highlightCode(code: string, lang: string): CodeToken[] | null {
  const def = LANGS.get(lang.trim().toLowerCase());
  if (def === undefined) return null;
  return tokenize(code, def);
}
