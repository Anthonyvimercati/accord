/**
 * Tests for the zero-dependency code tokenizer: per-language keyword/string/
 * comment/number recognition, the concatenation invariant (tokens rebuild the
 * exact input), unknown languages, and graceful handling of malformed code
 * (unterminated strings and comments).
 */

import { describe, expect, it } from 'vitest';
import { highlightCode, type CodeToken } from './highlight';

/** Rebuilds the source from tokens (must equal the input, always). */
function joined(tokens: readonly CodeToken[]): string {
  return tokens.map((t) => t.value).join('');
}

function kinds(tokens: readonly CodeToken[]): string[] {
  return tokens.map((t) => `${t.kind}:${t.value}`);
}

describe('highlightCode — language table', () => {
  it('returns null for unknown languages', () => {
    expect(highlightCode('x', 'brainfuck')).toBeNull();
    expect(highlightCode('x', '')).toBeNull();
  });

  it('accepts aliases and is case/whitespace insensitive', () => {
    expect(highlightCode('let x', 'TS')).not.toBeNull();
    expect(highlightCode('let x', ' javascript ')).not.toBeNull();
    expect(highlightCode('x = 1', 'python3')).not.toBeNull();
    expect(highlightCode('fn f() {}', 'rs')).not.toBeNull();
    expect(highlightCode('echo hi', 'zsh')).not.toBeNull();
  });

  it('returns an empty token list for empty code', () => {
    expect(highlightCode('', 'js')).toEqual([]);
  });
});

describe('highlightCode — js/ts', () => {
  it('tokenizes keywords, numbers and line comments', () => {
    const tokens = highlightCode('const x = 42; // hi', 'js');
    expect(tokens).not.toBeNull();
    expect(kinds(tokens ?? [])).toEqual([
      'keyword:const',
      'plain: x = ',
      'number:42',
      'plain:; ',
      'comment:// hi',
    ]);
  });

  it('tokenizes strings with escaped quotes', () => {
    const tokens = highlightCode('const s = "a\\"b"', 'ts');
    expect(kinds(tokens ?? [])).toEqual([
      'keyword:const',
      'plain: s = ',
      'string:"a\\"b"',
    ]);
  });

  it('treats template literals as multi-line strings', () => {
    const tokens = highlightCode('`a\nb`', 'js');
    expect(kinds(tokens ?? [])).toEqual(['string:`a\nb`']);
  });

  it('tokenizes block comments across lines', () => {
    const tokens = highlightCode('a /* x\ny */ b', 'js');
    expect(kinds(tokens ?? [])).toEqual(['plain:a ', 'comment:/* x\ny */', 'plain: b']);
  });

  it('recognizes hex and float literals', () => {
    const tokens = highlightCode('0xFF 1.5e3', 'js');
    expect(kinds(tokens ?? [])).toEqual(['number:0xFF', 'plain: ', 'number:1.5e3']);
  });

  it('does not highlight digits inside identifiers', () => {
    const tokens = highlightCode('abc123', 'js');
    expect(kinds(tokens ?? [])).toEqual(['plain:abc123']);
  });
});

describe('highlightCode — python', () => {
  it('tokenizes def, comments and strings', () => {
    const tokens = highlightCode("def f():  # c\n    return 'x'", 'py');
    expect(kinds(tokens ?? [])).toEqual([
      'keyword:def',
      'plain: f():  ',
      'comment:# c',
      'plain:\n    ',
      'keyword:return',
      'plain: ',
      "string:'x'",
    ]);
  });

  it('treats triple-quoted strings as one multi-line token', () => {
    const tokens = highlightCode('"""a\nb"""', 'python');
    expect(kinds(tokens ?? [])).toEqual(['string:"""a\nb"""']);
  });
});

describe('highlightCode — rust', () => {
  it('tokenizes fn/let and strings', () => {
    const tokens = highlightCode('fn main() { let s = "hi"; }', 'rust');
    expect(kinds(tokens ?? [])).toEqual([
      'keyword:fn',
      'plain: main() { ',
      'keyword:let',
      'plain: s = ',
      'string:"hi"',
      'plain:; }',
    ]);
  });

  it('does not treat lifetimes as strings', () => {
    const tokens = highlightCode("&'a str", 'rs');
    expect(kinds(tokens ?? [])).toEqual(["plain:&'a str"]);
  });
});

describe('highlightCode — json', () => {
  it('tokenizes literals, strings and numbers', () => {
    const tokens = highlightCode('{"a": true, "n": 1}', 'json');
    expect(kinds(tokens ?? [])).toEqual([
      'plain:{',
      'string:"a"',
      'plain:: ',
      'keyword:true',
      'plain:, ',
      'string:"n"',
      'plain:: ',
      'number:1',
      'plain:}',
    ]);
  });
});

describe('highlightCode — bash', () => {
  it('tokenizes builtins, strings and comments', () => {
    const tokens = highlightCode('echo "hi" # done', 'bash');
    expect(kinds(tokens ?? [])).toEqual([
      'keyword:echo',
      'plain: ',
      'string:"hi"',
      'plain: ',
      'comment:# done',
    ]);
  });
});

describe('highlightCode — html/css', () => {
  it('highlights tag names after < and </', () => {
    const tokens = highlightCode('<div class="x">a</div>', 'html');
    expect(kinds(tokens ?? [])).toEqual([
      'plain:<',
      'keyword:div',
      'plain: class=',
      'string:"x"',
      'plain:>a</',
      'keyword:div',
      'plain:>',
    ]);
  });

  it('tokenizes HTML comments', () => {
    const tokens = highlightCode('<!-- c -->', 'html');
    expect(kinds(tokens ?? [])).toEqual(['comment:<!-- c -->']);
  });

  it('highlights CSS properties and at-rules', () => {
    const tokens = highlightCode('@media x { color: red; }', 'css');
    expect(kinds(tokens ?? [])).toEqual([
      'keyword:@media',
      'plain: x { ',
      'keyword:color',
      'plain:: red; }',
    ]);
  });

  it('tokenizes CSS comments', () => {
    const tokens = highlightCode('/* c */ a', 'css');
    expect(kinds(tokens ?? [])).toEqual(['comment:/* c */', 'plain: a']);
  });
});

describe('highlightCode — malformed input degrades gracefully', () => {
  it('stops an unterminated single-line string at the line end', () => {
    const tokens = highlightCode('"abc\nnext', 'js');
    expect(kinds(tokens ?? [])).toEqual(['string:"abc', 'plain:\nnext']);
  });

  it('extends an unterminated block comment to the end of input', () => {
    const tokens = highlightCode('a /* never closed', 'js');
    expect(kinds(tokens ?? [])).toEqual(['plain:a ', 'comment:/* never closed']);
  });

  it('extends an unterminated multi-line string to the end of input', () => {
    const tokens = highlightCode('`abc', 'js');
    expect(kinds(tokens ?? [])).toEqual(['string:`abc']);
  });
});

describe('highlightCode — concatenation invariant', () => {
  const samples: readonly (readonly [string, string])[] = [
    ['js', 'const x = { a: "1", b: `t${x}`, c: 0b10 }; // done'],
    ['py', 'class A:\n    """doc"""\n    def f(self): return 1_000'],
    ['rust', 'pub fn f<T>(x: &T) -> u32 { /* body */ 0xFF }'],
    ['json', '{"k": [1, 2.5, null, "s"]}'],
    ['bash', 'if [ -f x ]; then echo "$y" # ok\nfi'],
    ['html', '<a href="https://ex.fr">x</a><!-- c -->'],
    ['css', '.a { margin: 0 auto; } @media (min-width: 600px) {}'],
  ];

  it.each(samples)('rebuilds the exact input for %s', (lang, code) => {
    const tokens = highlightCode(code, lang);
    expect(tokens).not.toBeNull();
    expect(joined(tokens ?? [])).toBe(code);
  });
});
