/**
 * Éditeur en place d'un message du fil : Entrée enregistre (texte non vide),
 * Échap annule. Le focus arrive en fin de texte à l'ouverture.
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '../stores/ui';

interface MessageEditorProps {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}

export function MessageEditor({ initial, onSave, onCancel }: MessageEditorProps) {
  const t = useT();
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = (): void => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    onSave(trimmed);
  };

  return (
    <div className="py-1">
      <textarea
        ref={ref}
        aria-label={t.dm.edit}
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
        className="max-h-48 min-h-[40px] w-full resize-none rounded-lg border border-rail/60 bg-input px-3 py-2 text-[15px] text-norm outline-none transition-colors duration-fast focus:border-blurple/50"
      />
      <div className="mt-0.5 text-[11px] text-faint">{t.dm.editHint}</div>
    </div>
  );
}
