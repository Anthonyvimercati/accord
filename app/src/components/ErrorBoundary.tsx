/**
 * Garde-fou de rendu : capture les exceptions levées pendant le rendu du
 * sous-arbre et affiche un écran de repli traduit au lieu de laisser toute
 * l'application en écran blanc.
 *
 * Composant de classe : React ne fournit `componentDidCatch` qu'aux classes.
 * L'enveloppe fonctionnelle exportée fournit les libellés (les hooks sont
 * interdits en classe) et la clé de réinitialisation.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useT } from '../stores/ui';

interface InnerProps {
  title: string;
  reloadLabel: string;
  /** Changer de clé (navigation) retente un rendu normal après une capture. */
  resetKey: string;
  children: ReactNode;
}

interface InnerState {
  hasError: boolean;
}

class ErrorBoundaryInner extends Component<InnerProps, InnerState> {
  state: InnerState = { hasError: false };

  static getDerivedStateFromError(): InnerState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Trace de diagnostic volontaire : l'erreur serait sinon invisible.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(prev: InnerProps): void {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-4 p-8"
      >
        <p className="text-lg font-semibold text-header">{this.props.title}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-blurple px-4 py-2 text-sm font-medium text-white transition-colors duration-fast hover:bg-blurple-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-chat"
        >
          {this.props.reloadLabel}
        </button>
      </div>
    );
  }
}

export function ErrorBoundary({
  children,
  resetKey = '',
}: {
  children: ReactNode;
  resetKey?: string;
}) {
  const t = useT();
  return (
    <ErrorBoundaryInner
      title={t.errors.boundaryTitle}
      reloadLabel={t.errors.boundaryReload}
      resetKey={resetKey}
    >
      {children}
    </ErrorBoundaryInner>
  );
}
