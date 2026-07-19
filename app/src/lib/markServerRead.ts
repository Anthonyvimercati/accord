/**
 * « Marquer le serveur comme lu » : parcourt les salons texte/annonces à
 * non-lus et réutilise `markRead` salon par salon (même flux qu'à l'ouverture
 * d'un salon) — l'historique est rafraîchi d'abord pour connaître la dernière
 * horloge de Lamport. Best effort : un salon en échec n'empêche pas les
 * autres. Partagé par le menu contextuel du rail et le menu déroulant du
 * serveur.
 */

import { channelKey, useGroups } from '../stores/groups';

export async function marquerServeurLu(groupId: string): Promise<void> {
  const g = useGroups.getState();
  const chans = (g.states[groupId]?.channels ?? []).filter((c) => c.kind !== 'voice');
  for (const ch of chans) {
    if ((g.unread[groupId]?.[ch.channel_id] ?? 0) === 0) continue;
    try {
      await g.refreshHistory(groupId, ch.channel_id);
      const last = (
        useGroups.getState().messages[channelKey(groupId, ch.channel_id)] ?? []
      ).at(-1);
      if (last !== undefined) {
        await useGroups.getState().markRead(groupId, ch.channel_id, last.lamport);
      }
    } catch {
      // Best effort : les autres salons continuent d'être marqués.
    }
  }
}
