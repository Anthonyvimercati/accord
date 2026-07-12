/**
 * Tests du garde-fou de rendu : un enfant qui lève affiche l'écran de repli
 * traduit (titre + bouton recharger) au lieu de faire tomber l'application.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Bombe(): never {
  throw new Error('boum');
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('affiche le repli quand un enfant lève, pas le contenu', () => {
    // React relaie l'erreur capturée sur la console : silence attendu ici.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bombe />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('rend les enfants sains tels quels', () => {
    render(
      <ErrorBoundary>
        <p>contenu sain</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('contenu sain')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
