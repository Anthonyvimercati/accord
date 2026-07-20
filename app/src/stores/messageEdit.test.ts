/** Tests du signal d'édition en place : requête avec nonce, consommation. */

import { beforeEach, describe, expect, it } from 'vitest';
import { useMessageEdit } from './messageEdit';

beforeEach(() => {
  useMessageEdit.setState({ request: null });
});

describe('useMessageEdit', () => {
  it('émet une requête et incrémente le nonce à chaque appel', () => {
    useMessageEdit.getState().requestEdit('m1');
    const first = useMessageEdit.getState().request;
    expect(first?.msgId).toBe('m1');

    useMessageEdit.getState().requestEdit('m1');
    expect(useMessageEdit.getState().request?.nonce).toBe((first?.nonce ?? 0) + 1);
  });

  it('consomme la requête courante', () => {
    useMessageEdit.getState().requestEdit('m1');
    useMessageEdit.getState().clearEditRequest();
    expect(useMessageEdit.getState().request).toBeNull();
  });
});
