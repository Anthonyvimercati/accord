/** Briques partagées des onglets de paramètres : sections et pastilles. */

import type { ReactNode } from 'react';

/** Section titrée d'un onglet (titre en petites capitales, façon Discord). */
export function SettingsSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="mb-8">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
        {title}
      </h3>
      {hint !== undefined && <p className="mb-3 text-sm text-muted">{hint}</p>}
      {children}
    </section>
  );
}

/** Rangée interrupteur : libellé + indice à gauche, bascule à droite. */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="mb-2 flex w-full items-center justify-between gap-4 rounded-lg bg-sidebar px-4 py-3 text-left transition-colors duration-150 hover:bg-chat-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-header">{label}</span>
        {hint !== undefined && (
          <span className="mt-0.5 block text-xs text-muted">{hint}</span>
        )}
      </span>
      <span
        aria-hidden
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150 ${
          checked ? 'bg-green' : 'bg-input'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-150 ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </span>
    </button>
  );
}

/** Pastille d'option exclusive (`aria-pressed` reflète la sélection). */
export function OptionPill({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
        selected
          ? 'bg-blurple text-white'
          : 'bg-rail text-norm hover:bg-input hover:text-header'
      }`}
    >
      {children}
    </button>
  );
}
