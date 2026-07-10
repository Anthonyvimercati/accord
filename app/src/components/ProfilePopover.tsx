/**
 * Carte de profil façon Discord, ouverte au clic sur un pseudo ou un avatar
 * (messages, liste des membres). Affiche grand avatar, pseudo, pastille de
 * présence, bio et, en contexte de serveur, les rôles colorés du membre.
 * Actions : « Envoyer un message » (si ami) et « Bloquer ».
 * Se ferme au clic extérieur et à Échap ; positionnée près du déclencheur.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { displayNameOf, useFriends } from '../stores/friends';
import { roleColorCss, sortRoles, useGroups } from '../stores/groups';
import { selfDisplayName, useSession } from '../stores/session';
import { useUi, useT, type AncrePopover } from '../stores/ui';
import { lireFichier } from '../lib/files';
import { Avatar } from './Avatar';

/** Largeur de la carte (px, façon Discord) ; sert au calcul de position initial. */
const CARD_WIDTH = 340;
/** Marge minimale au bord du viewport (px). */
const MARGE = 8;

/**
 * Bandeau de bannière en tête de carte : charge le blob par son hash Merkle
 * (comme `Avatar`) et l'affiche en paysage ; repli sur un fond neutre tant que
 * l'image est absente, en cours de chargement, ou indisponible.
 */
function BanniereProfil({ hash, hint }: { hash: string | null; hint: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (hash === null) return undefined;
    lireFichier(hash, hint)
      .then((blobUrl) => {
        if (alive) setUrl(blobUrl);
      })
      .catch(() => {
        // Bannière indisponible : on garde le fond neutre.
      });
    return () => {
      alive = false;
    };
  }, [hash, hint]);

  if (url === null) return <div className="h-20 bg-rail" aria-hidden />;
  return <img src={url} alt="" aria-hidden className="h-20 w-full object-cover" />;
}

/** Position `fixed` (px) de la carte, calée près de l'ancre et bornée à l'écran. */
function calculerPosition(
  ancre: AncrePopover,
  hauteur: number,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(MARGE, Math.min(ancre.left, vw - CARD_WIDTH - MARGE));
  // Sous l'ancre si la place le permet, au-dessus sinon.
  const enDessous = ancre.bottom + MARGE + hauteur <= vh;
  const top = enDessous
    ? ancre.bottom + MARGE
    : Math.max(MARGE, ancre.top - MARGE - hauteur);
  return { left, top };
}

export function ProfilePopover() {
  const t = useT();
  const profile = useUi((s) => s.profile);
  const closeProfile = useUi((s) => s.closeProfile);
  const closeModal = useUi((s) => s.closeModal);
  const setView = useUi((s) => s.setView);
  const toast = useUi((s) => s.toast);
  const contacts = useFriends((s) => s.contacts);
  const block = useFriends((s) => s.block);
  const openModal = useUi((s) => s.openModal);
  const self = useSession((s) => s.self);
  const state = useGroups((s) =>
    profile?.groupId != null ? s.states[profile.groupId] : undefined,
  );
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Position calée après mesure réelle de la carte (hauteur variable).
  useLayoutEffect(() => {
    if (profile === null || ref.current === null) return;
    setPos(calculerPosition(profile.ancre, ref.current.offsetHeight));
  }, [profile]);

  useEffect(() => {
    if (profile === null) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeProfile();
    };
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) closeProfile();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [profile, closeProfile]);

  if (profile === null) return null;

  const pubkey = profile.pubkey;
  const isSelf = self !== null && pubkey === self.pubkey;
  const contact = contacts.find((c) => c.pubkey === pubkey);
  const name =
    isSelf && self !== null ? selfDisplayName(self) : displayNameOf(contacts, pubkey);
  const avatarHash = isSelf && self !== null ? self.avatar : (contact?.avatar ?? null);
  const bannerHash = isSelf && self !== null ? self.banner : (contact?.banner ?? null);
  const bio = isSelf && self !== null ? self.bio : (contact?.bio ?? null);
  const online = isSelf ? true : contact?.online;

  const member = state?.members.find((m) => m.pubkey === pubkey);
  const roles =
    state !== undefined && member !== undefined
      ? sortRoles(state.roles).filter((r) => member.roles.includes(r.role_id))
      : [];
  const isFounder = state?.founder === pubkey;

  const canMessage = !isSelf && contact?.state === 'friend';
  const canBlock = !isSelf && contact !== undefined && contact.state !== 'blocked';

  const envoyerMessage = (): void => {
    closeModal();
    setView({ kind: 'dm', peer: pubkey });
  };

  const modifierProfil = (): void => {
    closeProfile();
    openModal({ kind: 'settings' });
  };

  const bloquer = (): void => {
    block(pubkey).catch(() => toast('error', t.errors.actionFailed));
    closeProfile();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t.profil.title}
      style={{
        position: 'fixed',
        left: pos?.left ?? profile.ancre.left,
        top: pos?.top ?? profile.ancre.bottom,
        width: CARD_WIDTH,
        visibility: pos === null ? 'hidden' : 'visible',
      }}
      className="z-50 overflow-hidden rounded-lg bg-modal shadow-modal"
    >
      <BanniereProfil hash={bannerHash} hint={pubkey} />
      <div className="-mt-8 px-4 pb-4">
        <div className="mb-2 flex items-end justify-between">
          <div className="rounded-full border-4 border-modal">
            <Avatar
              id={pubkey}
              name={name}
              size={72}
              avatarHash={avatarHash}
              hint={pubkey}
            />
          </div>
          {online !== undefined && (
            <span className="mb-1 flex items-center gap-1.5 text-xs text-muted">
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-green' : 'bg-faint'}`}
              />
              {online ? t.profil.online : t.profil.offline}
            </span>
          )}
        </div>

        <div className="rounded-lg bg-sidebar p-3">
          <div className="flex items-center gap-2">
            <span className="truncate text-lg font-bold text-header">{name}</span>
            {isFounder && (
              <span className="shrink-0 text-[10px] uppercase text-yellow">
                {t.groups.founder}
              </span>
            )}
          </div>

          {bio !== null && bio !== '' && (
            <>
              <div className="mt-3 h-px bg-input" role="separator" />
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-norm">
                {bio}
              </p>
            </>
          )}

          {roles.length > 0 && (
            <>
              <div className="mt-3 h-px bg-input" role="separator" />
              <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-faint">
                {t.profil.rolesLabel}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {roles.map((role) => {
                  const couleur = role.color === 0 ? null : roleColorCss(role.color);
                  return (
                    <span
                      key={role.role_id}
                      className="flex items-center gap-1 rounded bg-rail px-2 py-0.5 text-xs text-norm"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: couleur ?? 'rgb(var(--color-faint))' }}
                      />
                      {role.name}
                    </span>
                  );
                })}
              </div>
            </>
          )}

          {isSelf && (
            <button
              type="button"
              onClick={modifierProfil}
              className="mt-3 w-full rounded bg-blurple px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blurple-hover"
            >
              {t.profil.editProfile}
            </button>
          )}

          {(canMessage || canBlock) && (
            <div className="mt-3 flex gap-2">
              {canMessage && (
                <button
                  type="button"
                  onClick={envoyerMessage}
                  className="flex-1 rounded bg-blurple px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blurple-hover"
                >
                  {t.friends.sendDm}
                </button>
              )}
              {canBlock && (
                <button
                  type="button"
                  onClick={bloquer}
                  className="rounded border border-red px-3 py-1.5 text-sm font-medium text-red transition-colors hover:bg-red hover:text-white"
                >
                  {t.friends.block}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
