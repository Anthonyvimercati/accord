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
