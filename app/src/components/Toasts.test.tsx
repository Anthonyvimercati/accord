/** Tests des toasts : rendu par nature (succès/erreur/info) et accessibilité. */

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useUi } from '../stores/ui';
import { Toasts } from './Toasts';

afterEach(() => {
  useUi.setState({ toasts: [] });
});

describe('Toasts', () => {
  it('ne rend rien sans toast', () => {
    useUi.setState({ toasts: [] });
    const { container } = render(<Toasts />);
    expect(container).toBeEmptyDOMElement();
  });

  it('rend le texte de chaque toast', () => {
    useUi.setState({
      toasts: [
        { id: 1, kind: 'success', text: 'Copié !' },
        { id: 2, kind: 'info', text: 'Info' },
      ],
    });
    render(<Toasts />);
    expect(screen.getByText('Copié !')).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();
  });

  it('annonce une erreur en priorité via role="alert"', () => {
    useUi.setState({ toasts: [{ id: 3, kind: 'error', text: 'Échec' }] });
    render(<Toasts />);
    const alerte = screen.getByRole('alert');
    expect(alerte).toHaveTextContent('Échec');
  });

  it('ne met pas les toasts non-erreur en role alert', () => {
    useUi.setState({ toasts: [{ id: 4, kind: 'success', text: 'OK' }] });
    render(<Toasts />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
