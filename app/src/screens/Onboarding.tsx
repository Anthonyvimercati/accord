/**
 * Onboarding : création d'identité (phrase de passe), restauration par phrase
 * de récupération, déverrouillage — pensé pour des non-techniciens.
 * `CreateForm`/`RestoreForm` sont paramétrées par l'action de soumission
 * (`onSubmit`) : réutilisées telles quelles par le sélecteur de comptes
 * (`AccountPicker`) pour « Ajouter un compte » / « Importer depuis une
 * phrase de récupération », câblées sur `createAccount`/`restoreAccount`
 * plutôt que `create`/`restore` — jamais sur le profil actif courant.
 */

import { useRef, useState } from 'react';
import { type AvatarEncode } from '../lib/image';
import { initials } from '../lib/format';
import { isValidName, useSession } from '../stores/session';
import { useUi, useT } from '../stores/ui';
import { AvatarCropper } from '../components/AvatarCropper';
import { Card, Field, PrimaryButton } from './onboardingUi';

const MIN_PASSPHRASE = 12;

export function CreateForm({
  onSubmit,
  onRestore,
  onCancel,
}: {
  onSubmit: (passphrase: string) => Promise<void>;
  onRestore: () => void;
  /** Lien de retour additionnel (sélecteur de comptes) ; absent en 1er lancement. */
  onCancel?: () => void;
}) {
  const t = useT();
  const error = useSession((s) => s.error);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');

  const tooShort = pass.length > 0 && pass.length < MIN_PASSPHRASE;
  const mismatch = confirm.length > 0 && pass !== confirm;
  const ready = pass.length >= MIN_PASSPHRASE && pass === confirm;

  return (
    <Card>
      <h1 className="text-center text-2xl font-bold text-header">
        {t.onboarding.welcome}
      </h1>
      <p className="mb-6 mt-1 text-center text-sm text-muted">{t.onboarding.tagline}</p>
      <h2 className="mb-3 font-semibold text-header">{t.onboarding.createTitle}</h2>
      <p className="mb-4 text-sm text-muted">{t.onboarding.createHint}</p>
      <Field label={t.onboarding.passphrase} value={pass} onChange={setPass} />
      <Field
        label={t.onboarding.passphraseConfirm}
        value={confirm}
        onChange={setConfirm}
      />
      <p className="mb-4 -mt-2 text-xs text-faint">{t.onboarding.passphraseHint}</p>
      {tooShort && (
        <p className="mb-3 text-sm text-red">{t.onboarding.passphraseTooShort}</p>
      )}
      {mismatch && (
        <p className="mb-3 text-sm text-red">{t.onboarding.passphraseMismatch}</p>
      )}
      {error !== null && <p className="mb-3 text-sm text-red">{error}</p>}
      <PrimaryButton
        label={t.onboarding.create}
        disabled={!ready}
        onClick={() => void onSubmit(pass)}
      />
      <button
        type="button"
        onClick={onRestore}
        className="mt-4 w-full text-center text-sm text-link hover:underline"
      >
        {t.onboarding.restoreLink}
      </button>
      {onCancel !== undefined && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 w-full text-center text-sm text-faint hover:underline"
        >
          {t.onboarding.backToList}
        </button>
      )}
    </Card>
  );
}

export function RestoreForm({
  onSubmit,
  onBack,
  onCancel,
}: {
  onSubmit: (phrase: string, passphrase: string) => Promise<void>;
  onBack: () => void;
  /** Lien de retour additionnel (sélecteur de comptes) ; absent en 1er lancement. */
  onCancel?: () => void;
}) {
  const t = useT();
  const error = useSession((s) => s.error);
  const [phrase, setPhrase] = useState('');
  const [pass, setPass] = useState('');

  const wordCount = phrase.trim().split(/\s+/).filter(Boolean).length;
  const ready = wordCount === 12 && pass.length >= MIN_PASSPHRASE;

  return (
    <Card>
      <h1 className="mb-4 text-center text-2xl font-bold text-header">
        {t.onboarding.restoreTitle}
      </h1>
      <Field
        label={t.onboarding.recoveryPhrase}
        type="text"
        value={phrase}
        onChange={setPhrase}
        placeholder={t.onboarding.recoveryPhrasePlaceholder}
      />
      <Field label={t.onboarding.passphrase} value={pass} onChange={setPass} />
      <p className="mb-4 -mt-2 text-xs text-faint">{t.onboarding.passphraseHint}</p>
      {error !== null && <p className="mb-3 text-sm text-red">{error}</p>}
      <PrimaryButton
        label={t.onboarding.restore}
        disabled={!ready}
        onClick={() => void onSubmit(phrase, pass)}
      />
      <button
        type="button"
        onClick={onBack}
        className="mt-4 w-full text-center text-sm text-link hover:underline"
      >
        {t.onboarding.createLink}
      </button>
      {onCancel !== undefined && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 w-full text-center text-sm text-faint hover:underline"
        >
          {t.onboarding.backToList}
        </button>
      )}
    </Card>
  );
}

function UnlockForm() {
  const t = useT();
  const unlock = useSession((s) => s.unlock);
  const goToWelcome = useSession((s) => s.goToWelcome);
  const error = useSession((s) => s.error);
  const [pass, setPass] = useState('');

  return (
    <Card>
      <h1 className="mb-6 text-center text-2xl font-bold text-header">
        {t.onboarding.unlockTitle}
      </h1>
      <Field label={t.onboarding.passphrase} value={pass} onChange={setPass} />
      {error !== null && (
        <p className="mb-3 text-sm text-red">{t.onboarding.wrongPassphrase}</p>
      )}
      <PrimaryButton
        label={t.onboarding.unlock}
        disabled={pass.length === 0}
        onClick={() => void unlock(pass)}
      />
      <button
        type="button"
        onClick={() => void goToWelcome()}
        className="mt-4 w-full text-center text-sm text-link hover:underline"
      >
        {t.onboarding.switchAccountLink}
      </button>
    </Card>
  );
}

function Starting() {
  const t = useT();
  return (
    <Card>
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blurple border-t-transparent" />
        <p className="font-medium text-header">{t.onboarding.creating}</p>
        <p className="text-sm text-muted">{t.onboarding.creatingHint}</p>
      </div>
    </Card>
  );
}

/**
 * Affichage unique de la phrase de récupération après création. Mise en
 * page critique : la grille de mots reste sur une surface pleine (`bg-rail`,
 * jamais le verre translucide du panneau) pour garder une lisibilité
 * maximale de cette information irremplaçable.
 */
export function RecoveryPhraseScreen({ phrase }: { phrase: string }) {
  const t = useT();
  const ack = useSession((s) => s.ackRecoveryPhrase);
  const words = phrase.split(/\s+/).filter(Boolean);

  return (
    <Card>
      <h1 className="mb-2 text-center text-2xl font-bold text-header">
        {t.onboarding.phraseTitle}
      </h1>
      <p className="mb-5 text-sm text-yellow">{t.onboarding.phraseWarning}</p>
      <ol className="mb-6 grid grid-cols-3 gap-2">
        {words.map((word, i) => (
          <li
            key={`${word}-${i}`}
            className="selectable rounded-md bg-rail px-2 py-1.5 font-mono text-sm text-header"
          >
            <span className="mr-1.5 text-faint">{i + 1}.</span>
            {word}
          </li>
        ))}
      </ol>
      <PrimaryButton label={t.onboarding.phraseConfirm} onClick={ack} />
    </Card>
  );
}

/**
 * Troisième écran d'accueil : choix du pseudo après création ou restauration,
 * avatar optionnel (même mécanique que dans les paramètres), passable
 * (« Plus tard ») — aucun jargon.
 */
export function ChooseNameScreen() {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const setName = useSession((s) => s.setName);
  const setAvatar = useSession((s) => s.setAvatar);
  const skip = useSession((s) => s.skipNamePrompt);
  const [name, setNameDraft] = useState('');
  const [avatar, setAvatarDraft] = useState<AvatarEncode | null>(null);
  /** Image en cours de recadrage (recadreur ouvert tant que non nulle). */
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const valid = isValidName(name);
  const showInvalid = name.trim() !== '' && !valid;

  const submit = async (): Promise<void> => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (avatar !== null) await setAvatar(avatar.dataB64, avatar.mime);
      await setName(name.trim());
    } catch {
      toast('error', t.errors.actionFailed);
      setBusy(false);
    }
  };

  return (
    <Card>
      <h1 className="mb-2 text-center text-2xl font-bold text-header">
        {t.onboarding.nameTitle}
      </h1>
      <p className="mb-6 text-center text-sm text-muted">{t.onboarding.nameHint}</p>
      <Field
        label={t.onboarding.nameLabel}
        type="text"
        value={name}
        onChange={setNameDraft}
        placeholder={t.onboarding.namePlaceholder}
      />
      {showInvalid && <p className="mb-3 text-sm text-red">{t.onboarding.nameInvalid}</p>}
      <div className="mb-4">
        <span className="mb-1.5 block text-xs font-semibold uppercase text-muted">
          {t.onboarding.avatarLabel}
        </span>
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rail font-semibold text-norm"
          >
            {avatar !== null ? (
              <img
                src={avatar.dataUrl}
                alt=""
                width={56}
                height={56}
                className="h-full w-full object-cover"
              />
            ) : (
              initials(name.trim() !== '' ? name : '?')
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            aria-label={t.onboarding.avatarChoose}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Autorise de re-choisir le même fichier plus tard.
              e.target.value = '';
              if (file !== undefined) setCropFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-sm bg-rail px-3 py-2 text-sm font-medium text-norm transition-colors duration-fast hover:bg-input"
          >
            {t.onboarding.avatarChoose}
          </button>
          {avatar !== null && (
            <button
              type="button"
              onClick={() => setAvatarDraft(null)}
              className="text-sm text-link hover:underline"
            >
              {t.onboarding.avatarRemove}
            </button>
          )}
        </div>
      </div>
      <PrimaryButton
        label={t.onboarding.nameSubmit}
        disabled={!valid || busy}
        onClick={() => void submit()}
      />
      <button
        type="button"
        onClick={skip}
        className="mt-4 w-full text-center text-sm text-link hover:underline"
      >
        {t.onboarding.nameLater}
      </button>
      {cropFile !== null && (
        <AvatarCropper
          fichier={cropFile}
          forme="cercle"
          onAnnuler={() => setCropFile(null)}
          onValider={(r) => {
            setAvatarDraft(r);
            setCropFile(null);
          }}
        />
      )}
    </Card>
  );
}

export function Onboarding() {
  const phase = useSession((s) => s.phase);
  const create = useSession((s) => s.create);
  const restore = useSession((s) => s.restore);
  const [mode, setMode] = useState<'create' | 'restore'>('create');

  if (phase === 'starting') return <Starting />;
  if (phase === 'locked') return <UnlockForm />;
  return mode === 'create' ? (
    <CreateForm onSubmit={create} onRestore={() => setMode('restore')} />
  ) : (
    <RestoreForm onSubmit={restore} onBack={() => setMode('create')} />
  );
}
