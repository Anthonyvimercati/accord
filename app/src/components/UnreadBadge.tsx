/**
 * Pastille de non-lus façon Discord : compte sur fond rouge, alignée à
 * droite de sa ligne. Rien n'est rendu sans non-lu.
 */

import { interpolate } from '../i18n';
import { useT } from '../stores/ui';

export function UnreadBadge({ count }: { count: number }) {
  const t = useT();
  if (count <= 0) return null;
  return (
    <span
      aria-label={interpolate(t.dm.unreadBadge, { count: String(count) })}
      className="ml-auto min-w-4 shrink-0 rounded-full bg-red px-1.5 text-center text-xs font-semibold leading-4 text-white"
    >
      {count}
    </span>
  );
}
