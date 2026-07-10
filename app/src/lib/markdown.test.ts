/**
 * Tests du markdown léger PUR : chaque marque (gras, italique, barré, code,
 * bloc, spoiler, lien, mention, émoji), imbrication, échappement, gardes de
 * limite de mot et cas dégénérés (délimiteurs non fermés).
 */

import { describe, expect, it } from 'vitest';
import { analyserMarkdown, type MdNode } from './markdown';

const text = (value: string): MdNode => ({ type: 'text', value });

describe('analyserMarkdown — texte et sauts de ligne', () => {
  it('rend le texte brut tel quel', () => {
    expect(analyserMarkdown('bonjour à tous')).toEqual([text('bonjour à tous')]);
  });

  it('découpe les sauts de ligne en nœuds break', () => {
    expect(analyserMarkdown('a\nb')).toEqual([text('a'), { type: 'break' }, text('b')]);
  });

  it('rend une chaîne vide sans nœud', () => {
    expect(analyserMarkdown('')).toEqual([]);
  });
});

describe('analyserMarkdown — mise en forme', () => {
  it('gras **…**', () => {
    expect(analyserMarkdown('**gras**')).toEqual([
      { type: 'bold', children: [text('gras')] },
    ]);
  });

  it('italique *…*', () => {
    expect(analyserMarkdown('*ital*')).toEqual([
      { type: 'italic', children: [text('ital')] },
    ]);
  });

  it('italique _…_ aux bords de mot', () => {
    expect(analyserMarkdown('_ital_')).toEqual([
      { type: 'italic', children: [text('ital')] },
    ]);
  });

  it('ne coupe pas les underscores au milieu d’un mot (snake_case)', () => {
    expect(analyserMarkdown('snake_case')).toEqual([text('snake_case')]);
  });

  it('barré ~~…~~', () => {
    expect(analyserMarkdown('~~barré~~')).toEqual([
      { type: 'strike', children: [text('barré')] },
    ]);
  });

  it('spoiler ||…||', () => {
    expect(analyserMarkdown('||secret||')).toEqual([
      { type: 'spoiler', children: [text('secret')] },
    ]);
  });

  it('imbrique italique dans gras', () => {
    expect(analyserMarkdown('**gras _ital_**')).toEqual([
      {
        type: 'bold',
        children: [text('gras '), { type: 'italic', children: [text('ital')] }],
      },
    ]);
  });
});

describe('analyserMarkdown — code (littéral)', () => {
  it('code inline `…` sans sous-mise-en-forme', () => {
    expect(analyserMarkdown('`**x**`')).toEqual([{ type: 'code', value: '**x**' }]);
  });

  it('bloc de code ```…``` avec sauts de ligne', () => {
    expect(analyserMarkdown('```\nhello\nworld\n```')).toEqual([
      { type: 'codeblock', value: 'hello\nworld' },
    ]);
  });

  it('bloc de code sur une ligne', () => {
    expect(analyserMarkdown('```code```')).toEqual([
      { type: 'codeblock', value: 'code' },
    ]);
  });
});

describe('analyserMarkdown — liens', () => {
  it('détecte une URL https', () => {
    expect(analyserMarkdown('https://exemple.fr')).toEqual([
      { type: 'link', href: 'https://exemple.fr', value: 'https://exemple.fr' },
    ]);
  });

  it('retire la ponctuation finale de l’URL', () => {
    expect(analyserMarkdown('voir https://ex.fr.')).toEqual([
      text('voir '),
      { type: 'link', href: 'https://ex.fr', value: 'https://ex.fr' },
      text('.'),
    ]);
  });

  it('ne transforme pas un schéma non http(s)', () => {
    expect(analyserMarkdown('ftp://ex.fr')).toEqual([text('ftp://ex.fr')]);
  });
});

describe('analyserMarkdown — mentions et émojis', () => {
  it('mention @pseudo', () => {
    expect(analyserMarkdown('salut @bob !')).toEqual([
      text('salut '),
      { type: 'mention', name: 'bob' },
      text(' !'),
    ]);
  });

  it('émoji custom :name:', () => {
    expect(analyserMarkdown(':parrot:')).toEqual([{ type: 'emoji', name: 'parrot' }]);
  });

  it('ignore un nom d’émoji trop court (min 2)', () => {
    expect(analyserMarkdown(':x:')).toEqual([text(':x:')]);
  });

  it('compose émoji, gras et mention dans le même texte', () => {
    expect(analyserMarkdown('**hey** @bob :wave:')).toEqual([
      { type: 'bold', children: [text('hey')] },
      text(' '),
      { type: 'mention', name: 'bob' },
      text(' '),
      { type: 'emoji', name: 'wave' },
    ]);
  });
});

describe('analyserMarkdown — échappement et cas dégénérés', () => {
  it('l’antislash rend le caractère suivant littéral', () => {
    expect(analyserMarkdown('\\*pas gras\\*')).toEqual([text('*pas gras*')]);
  });

  it('un délimiteur non fermé reste littéral', () => {
    expect(analyserMarkdown('**pas fermé')).toEqual([text('**pas fermé')]);
  });

  it('ignore un délimiteur de fermeture échappé', () => {
    // Le premier `*` d'ouverture ne trouve pas de fermeture non échappée.
    expect(analyserMarkdown('*a\\*b')).toEqual([text('*a*b')]);
  });
});
