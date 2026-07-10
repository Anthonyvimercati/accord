/**
 * Recherche locale (mode accueil) : interroge `search.query` (index HMAC
 * aveugle côté nœud) puis résout les identifiants rendus dans les historiques
 * déjà chargés pour afficher des extraits cliquables qui ouvrent la
 * conversation correspondante.
 */

import { useState } from 'react';
import { interpolate } from '../i18n';
import { api } from '../lib/client';
import { formatTimestamp, shortId } from '../lib/format';
import { resolveSearchHits, type SearchHit, type SearchResolution } from '../lib/search';
import { useDms } from '../stores/dms';
import { useFriends, displayNameOf } from '../stores/friends';
import { useGroups } from '../stores/groups';
import { useSession } from '../stores/session';
import { useUi, useT } from '../stores/ui';

function HitRow({ hit, onOpen }: { hit: SearchHit; onOpen: (hit: SearchHit) => void }) {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const contacts = useFriends((s) => s.contacts);
  const groupStates = useGroups((s) => s.states);
  const self = useSession((s) => s.self);

  let label: string;
  if (hit.location.kind === 'dm') {
    label = `@${displayNameOf(contacts, hit.location.peer)}`;
  } else {
    const state = groupStates[hit.location.groupId];
    const channelId = hit.location.channelId;
    const channel = state?.channels.find((c) => c.channel_id === channelId);
    label = `${state?.name ?? shortId(hit.location.groupId)} · #${channel?.name ?? shortId(channelId)}`;
  }

  const author =
    self !== null && hit.author === self.pubkey
      ? t.app.you
      : displayNameOf(contacts, hit.author);

  return (
    <button
      type="button"
      onClick={() => onOpen(hit)}
      className="block w-full rounded px-2 py-1.5 text-left hover:bg-chat-hover"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-semibold text-muted">{label}</span>
        <span className="shrink-0 text-[10px] text-faint">
          {formatTimestamp(hit.sentMs, lang)}
        </span>
      </div>
      <div className="truncate text-sm text-norm">
        <span className="text-faint">{author} : </span>
        {hit.text}
      </div>
    </button>
  );
}

export function SearchBar() {
  const t = useT();
  const setView = useUi((s) => s.setView);
  const toast = useUi((s) => s.toast);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SearchResolution | null>(null);

  const clear = (): void => {
    setQuery('');
    setResults(null);
  };

  const submit = async (): Promise<void> => {
    const trimmed = query.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    try {
      const { msg_ids } = await api.searchQuery(trimmed);
      setResults(
        resolveSearchHits(
          msg_ids,
          useDms.getState().conversations,
          useGroups.getState().messages,
        ),
      );
    } catch {
      toast('error', t.errors.loadFailed);
    } finally {
      setBusy(false);
    }
  };

  const open = (hit: SearchHit): void => {
    if (hit.location.kind === 'dm') {
      setView({ kind: 'dm', peer: hit.location.peer });
    } else {
      setView({
        kind: 'group',
        groupId: hit.location.groupId,
        channelId: hit.location.channelId,
      });
    }
    clear();
  };

  return (
    <div className="relative border-b border-rail p-2.5">
      <div className="flex items-center gap-1.5 rounded bg-rail px-2">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
          className="shrink-0 text-faint"
        >
          <path d="M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.24 4.25a1 1 0 0 0 1.42-1.42l-4.25-4.24A7.5 7.5 0 0 0 10.5 3Zm-5.5 7.5a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0Z" />
        </svg>
        <input
          aria-label={t.search.placeholder}
          placeholder={t.search.placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            if (e.key === 'Escape') clear();
          }}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-norm placeholder-faint outline-none"
        />
        {(query !== '' || results !== null) && (
          <button
            type="button"
            aria-label={t.search.clear}
            title={t.search.clear}
            onClick={clear}
            className="shrink-0 text-faint hover:text-norm"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M18.7 6.7a1 1 0 0 0-1.4-1.4L12 10.6 6.7 5.3a1 1 0 0 0-1.4 1.4l5.3 5.3-5.3 5.3a1 1 0 1 0 1.4 1.4l5.3-5.3 5.3 5.3a1 1 0 0 0 1.4-1.4L13.4 12l5.3-5.3Z" />
            </svg>
          </button>
        )}
      </div>
      {busy && <p className="px-1 pt-2 text-xs text-faint">{t.app.loading}</p>}
      {results !== null && !busy && (
        <div className="absolute inset-x-2 top-full z-10 mt-1 max-h-96 overflow-y-auto rounded-lg bg-tooltip p-2 shadow-elevation">
          <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-faint">
            {t.search.results} — {results.hits.length}
          </div>
          {results.hits.length === 0 && (
            <p className="px-2 py-2 text-sm text-muted">{t.search.noResults}</p>
          )}
          {results.hits.map((hit) => (
            <HitRow key={hit.msgId} hit={hit} onOpen={open} />
          ))}
          {results.unresolved > 0 && (
            <p className="px-2 pt-1.5 text-[11px] italic text-faint">
              {interpolate(t.search.notLoaded, { count: String(results.unresolved) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
