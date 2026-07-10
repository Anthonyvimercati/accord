/**
 * Onglet Membres : liste avec couleurs et rôles, expulsion (KICK) et
 * bannissement (BAN) confirmés. Le fondateur et soi-même sont intouchables
 * côté UI (le nœud vérifie de toute façon la hiérarchie).
 */

import { interpolate } from '../../i18n';
import { displayNameOf, useFriends } from '../../stores/friends';
import {
  useGroups,
  hasPerm,
  memberColor,
  sortRoles,
  PERMISSIONS,
} from '../../stores/groups';
import { selfDisplayName, useSession } from '../../stores/session';
import { useUi, useT } from '../../stores/ui';
import { Avatar } from '../Avatar';
import { ConfirmButton, messageOf } from './controls';

export function ServerMembersTab({ groupId }: { groupId: string }) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const contacts = useFriends((s) => s.contacts);
  const self = useSession((s) => s.self);
  const state = useGroups((s) => s.states[groupId]);
  const kick = useGroups((s) => s.kick);
  const ban = useGroups((s) => s.ban);

  if (!state) return null;

  const canKick = hasPerm(state.my_permissions, PERMISSIONS.KICK);
  const canBan = hasPerm(state.my_permissions, PERMISSIONS.BAN);

  const nameOf = (pubkey: string): string =>
    self !== null && pubkey === self.pubkey
      ? `${selfDisplayName(self)} (${t.app.you})`
      : displayNameOf(contacts, pubkey);

  const onError = (e: unknown): void =>
    toast('error', messageOf(e, t.errors.actionFailed));

  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
        {t.groups.members} — {state.members.length}
      </div>
      {state.members.map((member) => {
        const color = memberColor(member, state.roles);
        const owned = new Set(member.roles);
        const roleNames = sortRoles(state.roles)
          .filter((r) => owned.has(r.role_id))
          .map((r) => r.name);
        const isSelf = self !== null && member.pubkey === self.pubkey;
        const isFounder = state.founder === member.pubkey;
        const name = nameOf(member.pubkey);
        return (
          <div
            key={member.pubkey}
            className="mb-1 flex items-center gap-3 rounded-lg bg-sidebar px-3 py-2"
          >
            <Avatar id={member.pubkey} name={name} size={32} />
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-sm font-medium text-header"
                style={color !== null ? { color } : undefined}
              >
                {name}
              </div>
              <div className="truncate text-[11px] text-faint">
                {isFounder && (
                  <span className="uppercase text-yellow">{t.groups.founder}</span>
                )}
                {isFounder && roleNames.length > 0 && ' · '}
                {roleNames.join(' · ')}
              </div>
            </div>
            {!isSelf && !isFounder && (
              <div className="flex shrink-0 items-center gap-2">
                {canKick && (
                  <ConfirmButton
                    action={t.serveur.kick}
                    question={interpolate(t.serveur.kickConfirm, { name })}
                    onConfirm={() => {
                      kick(groupId, member.pubkey).catch(onError);
                    }}
                  />
                )}
                {canBan && (
                  <ConfirmButton
                    action={t.serveur.ban}
                    question={interpolate(t.serveur.banConfirm, { name })}
                    onConfirm={() => {
                      ban(groupId, member.pubkey).catch(onError);
                    }}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
