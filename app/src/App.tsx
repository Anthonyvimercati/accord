/** Racine : aiguillage onboarding / application, bandeau hors-ligne, toasts. */

import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { Toasts } from './components/Toasts';
import { AccountPicker } from './screens/AccountPicker';
import { ChooseNameScreen, Onboarding, RecoveryPhraseScreen } from './screens/Onboarding';
import { useSession } from './stores/session';
import { useT } from './stores/ui';

export function App() {
  const t = useT();
  const phase = useSession((s) => s.phase);
  const recoveryPhrase = useSession((s) => s.recoveryPhrase);
  const askName = useSession((s) => s.askName);
  const init = useSession((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  if (phase === 'boot') {
    return (
      <div className="flex h-full items-center justify-center bg-rail text-muted">
        {t.app.loading}
      </div>
    );
  }

  if (phase === 'setup' || phase === 'locked' || phase === 'starting') {
    return (
      <>
        <Onboarding />
        <Toasts />
      </>
    );
  }

  if (phase === 'welcome') {
    return (
      <>
        <AccountPicker />
        <Toasts />
      </>
    );
  }

  if (recoveryPhrase !== null) {
    return <RecoveryPhraseScreen phrase={recoveryPhrase} />;
  }

  // Troisième écran d'accueil : pseudo (après création/restauration seulement).
  if (askName) {
    return (
      <>
        <ChooseNameScreen />
        <Toasts />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {phase === 'offline' && (
        <div className="bg-red px-4 py-1 text-center text-sm font-medium text-white">
          {t.app.offline}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <AppShell />
      </div>
      <Toasts />
    </div>
  );
}
