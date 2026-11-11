import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeDeckHandoff, ownedHandoffDeck, readDeckHandoff } from '@client/deck-handoff';
import type { SavedDeck } from '@card-game/protocol';

const deckId = '00000000-0000-4000-8000-000000000001';
const saved = { id: deckId, name: 'Mono red' } as SavedDeck;

afterEach(() => { vi.unstubAllGlobals(); });

describe('deck handoff from the URL', () => {
  it('reads only a single well-formed deck reference', () => {
    expect(readDeckHandoff('?deckId=' + deckId)).toEqual({ kind: 'requested', id: deckId });
    expect(readDeckHandoff('')).toEqual({ kind: 'none' });
    expect(readDeckHandoff('?deckId=not-a-deck')).toEqual({ kind: 'invalid' });
    expect(readDeckHandoff('?deckId=' + deckId + '&deckId=' + deckId)).toEqual({ kind: 'invalid' });
  });

  it('never treats a requested reference as proof of ownership', () => {
    expect(ownedHandoffDeck({ kind: 'requested', id: deckId }, [saved])).toBe(saved);
    expect(ownedHandoffDeck({ kind: 'requested', id: deckId }, [])).toBeUndefined();
    expect(ownedHandoffDeck({ kind: 'none' }, [saved])).toBeUndefined();
    expect(ownedHandoffDeck({ kind: 'invalid' }, [saved])).toBeUndefined();
  });

  it('removes the handoff parameter without disturbing the rest of the location', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { href: 'https://cards.example/play?roomId=room-1&deckId=' + deckId + '#board' },
      history: { state: { marker: 7 }, replaceState },
    });

    consumeDeckHandoff();

    expect(replaceState).toHaveBeenCalledWith({ marker: 7 }, '', '/play?roomId=room-1#board');
  });

  it('does nothing without a browser window', () => {
    expect(() => consumeDeckHandoff()).not.toThrow();
  });
});
