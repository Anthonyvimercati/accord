/**
 * Corps textuel d'un message du fil : markdown (mentions, émojis custom,
 * couleurs de rôle), mention « modifié » après édition, et repli en italique
 * pour les messages supprimés ou au corps non pris en charge.
 */

import { useT } from '../stores/ui';
import { MarkdownText } from './MarkdownText';
import { displayText, type DisplayMessage } from './messageModel';

interface BodyTextProps {
  message: DisplayMessage;
  emojiMap?: ReadonlyMap<string, string> | undefined;
  knownMentions?: ReadonlySet<string> | undefined;
  roleColors?: ReadonlyMap<string, number> | undefined;
}

export function BodyText({ message, emojiMap, knownMentions, roleColors }: BodyTextProps) {
  const t = useT();
  if (message.deleted) {
    return <em className="text-faint">{t.dm.deletedMessage}</em>;
  }
  const text = displayText(message);
  if (text === null) {
    return <em className="text-faint">{t.dm.unsupported}</em>;
  }
  return (
    <span className="selectable whitespace-pre-wrap break-words">
      <MarkdownText
        text={text}
        emojis={emojiMap}
        knownMentions={knownMentions}
        roleColors={roleColors}
        hint={message.author}
      />
      {message.edited !== null && (
        <span className="ml-1 text-[10px] text-faint">{t.dm.edited}</span>
      )}
    </span>
  );
}
