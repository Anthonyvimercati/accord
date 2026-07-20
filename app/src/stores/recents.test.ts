/** Tests du store des émojis récents : ajout en tête, déduplication, persistance. */

import { beforeEach, describe, expect, it } from 'vitest';
import { RECENTS_STORAGE_KEY } from '../lib/emojiRecents';
import { useEmojiRecents } from './recents';

beforeEach(() => {
  window.localStorage.clear();
  useEmojiRecents.setState({ list: [] });
});

describe('useEmojiRecents', () => {
  it('ajoute un émoji unicode en tête et persiste', () => {
    useEmojiRecents.getState().add({ kind: 'unicode', char: '😀' });
    expect(useEmojiRecents.getState().list[0]).toEqual({ kind: 'unicode', char: '😀' });
    expect(window.localStorage.getItem(RECENTS_STORAGE_KEY)).not.toBeNull();
  });

  it('remonte un émoji réutilisé sans le dupliquer', () => {
    useEmojiRecents.getState().add({ kind: 'unicode', char: '😀' });
    useEmojiRecents.getState().add({ kind: 'unicode', char: '🎉' });
    useEmojiRecents.getState().add({ kind: 'unicode', char: '😀' });
    const chars = useEmojiRecents
      .getState()
      .list.map((p) => (p.kind === 'unicode' ? p.char : ''));
    expect(chars).toEqual(['😀', '🎉']);
  });
});
