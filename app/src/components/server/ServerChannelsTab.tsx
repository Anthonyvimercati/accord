/**
 * Onglet Salons : création (texte/vocal/annonces, catégorie optionnelle),
 * création de catégorie, puis liste par catégorie avec renommage, sujet et
 * suppression (confirmée). Tout est gouverné par MANAGE_CHANNELS.
 */

import { useState } from 'react';
import { interpolate } from '../../i18n';
import type { GroupChannel, GroupChannelKind } from '../../lib/api';
import { useGroups, channelsByCategory, hasPerm, PERMISSIONS } from '../../stores/groups';
import { useUi, useT } from '../../stores/ui';
import type { Dict } from '../../i18n';
import { SettingsSection } from '../settings/controls';
import { ConfirmButton, messageOf } from './controls';

const KINDS: Array<{ kind: GroupChannelKind; label: (t: Dict) => string }> = [
  { kind: 'text', label: (t) => t.serveur.kindText },
  { kind: 'voice', label: (t) => t.serveur.kindVoice },
  { kind: 'announcement', label: (t) => t.serveur.kindAnnouncement },
];

/** Libellé du genre d'un salon. */
function kindLabel(t: Dict, kind: GroupChannelKind): string {
  return KINDS.find((k) => k.kind === kind)?.label(t) ?? kind;
}

/** Éditeur en place d'un salon : nom, sujet, suppression confirmée. */
function ChannelEditor({
  groupId,
  channel,
  canManage,
}: {
  groupId: string;
  channel: GroupChannel;
  canManage: boolean;
}) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const renameChannel = useGroups((s) => s.renameChannel);
  const setTopic = useGroups((s) => s.setTopic);
  const deleteChannel = useGroups((s) => s.deleteChannel);
  const [name, setName] = useState(channel.name);
  const [topic, setTopicDraft] = useState(channel.topic);
  const [busy, setBusy] = useState(false);

  const hasTopic = channel.kind !== 'voice';
  const nameTrimmed = name.trim();
  const nameDirty = nameTrimmed !== channel.name && nameTrimmed !== '';
  const topicDirty = hasTopic && topic.trim() !== channel.topic;

  const save = async (): Promise<void> => {
    if (busy || (!nameDirty && !topicDirty)) return;
    setBusy(true);
    try {
      if (nameDirty) await renameChannel(groupId, channel.channel_id, nameTrimmed);
      if (topicDirty) await setTopic(groupId, channel.channel_id, topic.trim());
      toast('info', t.serveur.channelSaved);
    } catch (e) {
      toast('error', messageOf(e, t.errors.actionFailed));
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return (
      <div className="mb-2 rounded-lg bg-sidebar px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-header">{channel.name}</span>
          <span className="text-xs text-faint">{kindLabel(t, channel.kind)}</span>
        </div>
        {channel.topic !== '' && (
          <div className="mt-1 text-sm text-muted">{channel.topic}</div>
        )}
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-lg bg-sidebar p-3">
      <div className="flex items-center gap-3">
        <input
          aria-label={t.serveur.channelNameLabel}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded bg-rail px-3 py-2 text-norm outline-none focus-visible:ring-2 focus-visible:ring-blurple"
        />
        <span className="shrink-0 text-xs text-faint">{kindLabel(t, channel.kind)}</span>
      </div>
      {hasTopic && (
        <input
          aria-label={t.serveur.topicLabel}
          placeholder={t.serveur.topicPlaceholder}
          value={topic}
          onChange={(e) => setTopicDraft(e.target.value)}
          className="mt-2 w-full rounded bg-rail px-3 py-2 text-sm text-norm placeholder-faint outline-none focus-visible:ring-2 focus-visible:ring-blurple"
        />
      )}
      <div className="mt-2 flex items-center justify-between gap-3">
        <ConfirmButton
          action={t.serveur.deleteChannel}
          question={interpolate(t.serveur.deleteChannelConfirm, {
            name: channel.name,
          })}
          onConfirm={() => {
            deleteChannel(groupId, channel.channel_id).catch((e: unknown) =>
              toast('error', messageOf(e, t.errors.actionFailed)),
            );
          }}
        />
        <button
          type="button"
          disabled={busy || (!nameDirty && !topicDirty)}
          onClick={() => void save()}
          className="rounded bg-blurple px-4 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-blurple-hover disabled:opacity-50"
        >
          {t.serveur.channelSave}
        </button>
      </div>
    </div>
  );
}

export function ServerChannelsTab({ groupId }: { groupId: string }) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const state = useGroups((s) => s.states[groupId]);
  const addChannel = useGroups((s) => s.addChannel);
  const addCategory = useGroups((s) => s.addCategory);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<GroupChannelKind>('text');
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!state) return null;

  const canManage = hasPerm(state.my_permissions, PERMISSIONS.MANAGE_CHANNELS);
  const sections = channelsByCategory(state.channels, state.categories);

  const createChannel = async (): Promise<void> => {
    const name = newName.trim();
    if (name === '' || busy) return;
    setBusy(true);
    try {
      await addChannel(
        groupId,
        name,
        newKind,
        newCategory === '' ? undefined : newCategory,
      );
      setNewName('');
    } catch (e) {
      toast('error', messageOf(e, t.errors.actionFailed));
    } finally {
      setBusy(false);
    }
  };

  const createCategory = async (): Promise<void> => {
    const name = newCategoryName.trim();
    if (name === '' || busy) return;
    setBusy(true);
    try {
      await addCategory(groupId, name);
      setNewCategoryName('');
    } catch (e) {
      toast('error', messageOf(e, t.errors.actionFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {canManage && (
        <>
          <SettingsSection title={t.serveur.newChannelTitle}>
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-sidebar p-3">
              <input
                aria-label={t.serveur.channelNameLabel}
                placeholder={t.groups.channelNamePlaceholder}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createChannel();
                }}
                className="min-w-0 flex-1 rounded bg-rail px-3 py-2 text-norm placeholder-faint outline-none focus-visible:ring-2 focus-visible:ring-blurple"
              />
              <select
                aria-label={t.serveur.kindLabel}
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as GroupChannelKind)}
                className="rounded bg-rail px-2 py-2 text-sm text-norm outline-none"
              >
                {KINDS.map(({ kind, label }) => (
                  <option key={kind} value={kind}>
                    {label(t)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t.serveur.categoryLabel}
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="rounded bg-rail px-2 py-2 text-sm text-norm outline-none"
              >
                <option value="">{t.serveur.noCategory}</option>
                {state.categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={newName.trim() === '' || busy}
                onClick={() => void createChannel()}
                className="rounded bg-blurple px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blurple-hover disabled:opacity-50"
              >
                {t.groups.addChannelAction}
              </button>
            </div>
          </SettingsSection>

          <SettingsSection title={t.serveur.newCategoryTitle}>
            <div className="flex gap-3 rounded-lg bg-sidebar p-3">
              <input
                aria-label={t.serveur.categoryNamePlaceholder}
                placeholder={t.serveur.categoryNamePlaceholder}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createCategory();
                }}
                className="min-w-0 flex-1 rounded bg-rail px-3 py-2 text-norm placeholder-faint outline-none focus-visible:ring-2 focus-visible:ring-blurple"
              />
              <button
                type="button"
                disabled={newCategoryName.trim() === '' || busy}
                onClick={() => void createCategory()}
                className="rounded bg-blurple px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blurple-hover disabled:opacity-50"
              >
                {t.serveur.createCategoryAction}
              </button>
            </div>
          </SettingsSection>
        </>
      )}

      {sections.map((section) => {
        if (section.channels.length === 0) {
          // Catégorie vide : simple rappel de son existence.
          return section.category === null ? null : (
            <div
              key={section.category.category_id}
              className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-faint"
            >
              {section.category.name}
            </div>
          );
        }
        return (
          <SettingsSection
            key={section.category?.category_id ?? 'sans-categorie'}
            title={section.category?.name ?? t.serveur.noCategory}
          >
            {section.channels.map((channel) => (
              <ChannelEditor
                key={channel.channel_id}
                groupId={groupId}
                channel={channel}
                canManage={canManage}
              />
            ))}
          </SettingsSection>
        );
      })}
    </div>
  );
}
