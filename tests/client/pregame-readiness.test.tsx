import { describe, expect, it } from 'vitest';
import { registrationPasswordError, RegisterRequestSchema, LoginRequestSchema } from '@card-game/protocol';
import { lobbyBlockReason, type LobbyReadiness } from '@client/lobby-readiness';
import { CardCountControls, WorkspaceHeader } from '@card-game/ui';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ready: LobbyReadiness = { signedIn: true, loading: false, failed: false, hasDecks: true,
  selectedDeck: true, handoffPending: false, connected: true, pending: false };
describe('pregame setup', () => {
  it('blocks both room actions until account, owned deck, handoff and transport are ready', () => {
    expect(lobbyBlockReason(ready)).toBeNull();
    for (const patch of [{ signedIn: false }, { loading: true }, { failed: true }, { hasDecks: false },
      { selectedDeck: false }, { handoffPending: true }, { connected: false }, { pending: true }]) {
      expect(lobbyBlockReason({ ...ready, ...patch })).toBeTruthy();
    }
    expect(lobbyBlockReason({ ...ready, failed: true, hasDecks: false })).toContain('Retry');
  });
  it('uses normalized Unicode password lengths for registration while preserving login', () => {
    for (const password of ['short', 'a'.repeat(129), 'e\u0301'.repeat(14)]) {
      expect(registrationPasswordError(password)).toContain('15–128');
      expect(RegisterRequestSchema.safeParse({ protocolVersion: 1, username: 'alice', password }).success).toBe(false);
    }
    for (const password of ['a'.repeat(15), 'a'.repeat(128), 'e\u0301'.repeat(15), '😀'.repeat(15)]) {
      expect(registrationPasswordError(password)).toBeNull();
      expect(RegisterRequestSchema.safeParse({ protocolVersion: 1, username: 'alice', password }).success).toBe(true);
    }
    expect(LoginRequestSchema.safeParse({ protocolVersion: 1, username: 'alice', password: 'short' }).success).toBe(true);
  });
  it('keeps optional quantity entry out of existing scenario controls', () => {
    const props = { label: 'land-red', quantity: 4, onChange: () => {} };
    expect(renderToStaticMarkup(createElement(CardCountControls, props))).not.toContain('<input');
    expect(renderToStaticMarkup(createElement(CardCountControls, { ...props, onQuantity: () => null }))).toContain('Quantity of land-red');
  });
  it('keeps Play in this tab and protects an active room from other workspace navigation', () => {
    const navigation = { instanceId: 'local', purpose: 'development' as const, label: 'Local',
      home: '/home', play: '/play', decks: '/deck-builder/', admin: null, lab: null };
    const html = renderToStaticMarkup(createElement(WorkspaceHeader, { navigation, current: 'play', account: null, activeRoomId: 'room' }));
    const play = html.match(/<a[^>]+href="\/play\/rooms\/room"[^>]*>/)![0];
    const decks = html.match(/<a[^>]+href="\/deck-builder\/"[^>]*>/)![0];
    expect(play).not.toContain('target='); expect(decks).toContain('target="_blank"');
  });
});
