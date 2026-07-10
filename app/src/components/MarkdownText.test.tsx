/**
 * Tests du rendu markdown : mise en forme en éléments sémantiques, lien sûr
 * (target/rel), spoiler révélable, mentions et émojis custom rendus en image
 * (via le nom connu du serveur) ou laissés en texte sinon.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useUi } from '../stores/ui';

vi.mock('../lib/files', () => ({
  lireFichier: vi.fn(() => Promise.resolve('blob:emoji')),
}));

import { MarkdownText } from './MarkdownText';

beforeEach(() => {
  useUi.setState({ lang: 'fr' });
});

describe('MarkdownText — mise en forme', () => {
  it('rend le gras en <strong>', () => {
    render(<MarkdownText text="**gras**" />);
    expect(screen.getByText('gras').tagName).toBe('STRONG');
  });

  it('rend l’italique en <em>', () => {
    render(<MarkdownText text="*ital*" />);
    expect(screen.getByText('ital').tagName).toBe('EM');
  });

  it('rend le barré en <s>', () => {
    render(<MarkdownText text="~~barré~~" />);
    expect(screen.getByText('barré').tagName).toBe('S');
  });

  it('rend le code inline en <code>', () => {
    render(<MarkdownText text="`code`" />);
    expect(screen.getByText('code').tagName).toBe('CODE');
  });
});

describe('MarkdownText — liens sûrs', () => {
  it('rend un lien http avec target et rel de sécurité', () => {
    render(<MarkdownText text="https://exemple.fr" />);
    const lien = screen.getByText('https://exemple.fr');
    expect(lien.tagName).toBe('A');
    expect(lien).toHaveAttribute('href', 'https://exemple.fr');
    expect(lien).toHaveAttribute('target', '_blank');
    expect(lien).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('MarkdownText — spoiler', () => {
  it('masque le contenu puis le révèle au clic', () => {
    render(<MarkdownText text="||caché||" />);
    const bouton = screen.getByRole('button', { name: 'Spoiler — cliquez pour révéler' });
    expect(screen.getByText('caché')).toBeInTheDocument();

    fireEvent.click(bouton);

    expect(
      screen.queryByRole('button', { name: 'Spoiler — cliquez pour révéler' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('caché')).toBeInTheDocument();
  });
});

describe('MarkdownText — mentions', () => {
  it('affiche la mention (pill pour un membre connu)', () => {
    render(<MarkdownText text="salut @bob" knownMentions={new Set(['bob'])} />);
    const mention = screen.getByText('@bob');
    expect(mention.className).toContain('bg-blurple');
  });

  it('affiche une mention inconnue en simple surlignage', () => {
    render(<MarkdownText text="salut @inconnu" />);
    const mention = screen.getByText('@inconnu');
    expect(mention.className).not.toContain('bg-blurple');
    expect(mention.className).toContain('text-blurple');
  });
});

describe('MarkdownText — headings', () => {
  it('renders # / ## / ### as h1/h2/h3', () => {
    render(<MarkdownText text={'# Un\n## Deux\n### Trois'} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Un' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Deux' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Trois' })).toBeInTheDocument();
  });

  it('renders a known mention pill inside a heading', () => {
    render(<MarkdownText text="# salut @bob" knownMentions={new Set(['bob'])} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText('@bob').className).toContain('bg-blurple');
  });

  it('keeps a hash without space as plain text', () => {
    render(<MarkdownText text="#pas-titre" />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('#pas-titre')).toBeInTheDocument();
  });
});

describe('MarkdownText — lists', () => {
  it('renders an unordered list as ul/li', () => {
    render(<MarkdownText text={'- un\n- deux'} />);
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('UL');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders an ordered list with its start number', () => {
    render(<MarkdownText text={'3. a\n4. b'} />);
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(list).toHaveAttribute('start', '3');
  });

  it('renders one nested list level', () => {
    render(<MarkdownText text={'- a\n - a1\n- b'} />);
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    const outer = lists[0] as HTMLElement;
    const inner = lists[1] as HTMLElement;
    expect(outer.contains(inner)).toBe(true);
  });

  it('renders a custom emoji inside a list item', async () => {
    render(<MarkdownText text="- :parrot:" emojis={new Map([['parrot', 'racine']])} />);
    expect(await screen.findByAltText(':parrot:')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });
});

describe('MarkdownText — blockquotes', () => {
  it('renders > as a blockquote element', () => {
    const { container } = render(<MarkdownText text="> cité" />);
    const quote = container.querySelector('blockquote');
    expect(quote).not.toBeNull();
    expect(quote).toHaveTextContent('cité');
  });

  it('renders >>> with the whole remainder inside', () => {
    const { container } = render(<MarkdownText text={'>>> a\nb'} />);
    const quote = container.querySelector('blockquote');
    expect(quote).toHaveTextContent('a');
    expect(quote).toHaveTextContent('b');
  });
});

describe('MarkdownText — underline', () => {
  it('renders __…__ as <u>', () => {
    render(<MarkdownText text="__sous__" />);
    expect(screen.getByText('sous').tagName).toBe('U');
  });

  it('renders bold nested in underline', () => {
    render(<MarkdownText text="__a **b**__" />);
    expect(screen.getByText('b').tagName).toBe('STRONG');
    expect(screen.getByText('b').closest('u')).not.toBeNull();
  });
});

describe('MarkdownText — masked links', () => {
  it('renders the label with the real URL in href and title', () => {
    render(<MarkdownText text="[docs](https://ex.fr/doc)" />);
    const lien = screen.getByRole('link', { name: /docs/ });
    expect(lien).toHaveAttribute('href', 'https://ex.fr/doc');
    expect(lien).toHaveAttribute('title', 'https://ex.fr/doc');
    expect(lien).toHaveAttribute('target', '_blank');
    expect(lien).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('styles masked links distinctly from auto-links', () => {
    render(<MarkdownText text="[docs](https://ex.fr) et https://autre.fr" />);
    const masque = screen.getByRole('link', { name: /docs/ });
    const auto = screen.getByRole('link', { name: 'https://autre.fr' });
    expect(masque.className).toContain('decoration-dotted');
    expect(auto.className).not.toContain('decoration-dotted');
  });

  it('never renders a link for a non-http(s) scheme', () => {
    render(<MarkdownText text="[x](javascript:alert(1))" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('MarkdownText — highlighted code blocks', () => {
  it('colors keywords, numbers, strings and comments via themed classes', () => {
    render(<MarkdownText text={'```js\nconst x = 1; // hi\nconst s = "a";\n```'} />);
    const keyword = screen.getAllByText('const')[0] as HTMLElement;
    expect(keyword.tagName).toBe('SPAN');
    expect(keyword.className).toContain('text-blurple');
    expect((screen.getByText('1') as HTMLElement).className).toContain('text-yellow');
    expect((screen.getByText('// hi') as HTMLElement).className).toContain('text-faint');
    expect((screen.getByText('"a"') as HTMLElement).className).toContain('text-green');
  });

  it('renders unknown languages as plain text without token spans', () => {
    const { container } = render(
      <MarkdownText text={'```zorglang\nconst notColored\n```'} />,
    );
    const code = container.querySelector('pre code');
    expect(code).toHaveTextContent('const notColored');
    expect(code?.querySelector('span')).toBeNull();
  });

  it('renders untagged blocks as plain text', () => {
    const { container } = render(<MarkdownText text={'```\nplain\n```'} />);
    const code = container.querySelector('pre code');
    expect(code).toHaveTextContent('plain');
    expect(code?.querySelector('span')).toBeNull();
  });
});

describe('MarkdownText — mentions étendues', () => {
  it('rend @everyone en pastille distincte (accent jaune)', () => {
    render(<MarkdownText text="@everyone" />);
    expect(screen.getByText('@everyone').className).toContain('text-yellow');
  });

  it('rend @here en pastille distincte (accent jaune)', () => {
    render(<MarkdownText text="@here" />);
    expect(screen.getByText('@here').className).toContain('text-yellow');
  });

  it('rend une mention de rôle avec la couleur du rôle', () => {
    render(<MarkdownText text="@Mods" roleColors={new Map([['mods', 0xff0000]])} />);
    const el = screen.getByText('@Mods');
    expect(el.getAttribute('style')).toMatch(/color/);
    expect(el.className).not.toContain('text-yellow');
  });

  it('rend un rôle sans couleur en pastille blurple', () => {
    render(<MarkdownText text="@Neutre" roleColors={new Map([['neutre', 0]])} />);
    const el = screen.getByText('@Neutre');
    expect(el.className).toContain('text-blurple');
    expect(el.getAttribute('style')).toBeNull();
  });

  it('préfère le rôle au simple membre pour un nom homonyme', () => {
    render(
      <MarkdownText
        text="@Mods"
        knownMentions={new Set(['mods'])}
        roleColors={new Map([['mods', 0x00ff00]])}
      />,
    );
    // Le style couleur du rôle prime sur la pastille membre par défaut.
    expect(screen.getByText('@Mods').getAttribute('style')).toMatch(/color/);
  });
});

describe('MarkdownText — émojis custom', () => {
  it('rend l’émoji en image quand le serveur le connaît', async () => {
    render(<MarkdownText text=":parrot:" emojis={new Map([['parrot', 'racine']])} />);
    expect(await screen.findByAltText(':parrot:')).toBeInTheDocument();
  });

  it('laisse le jeton en texte quand l’émoji est inconnu', () => {
    render(<MarkdownText text=":parrot:" />);
    expect(screen.getByText(':parrot:')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
