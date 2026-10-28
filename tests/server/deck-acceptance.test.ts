import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { AuthResponseSchema, CatalogResponseSchema, DeckListResponseSchema, DeckResponseSchema, validateDeck, type AuthResponse, type DeckInput, type PlayerView } from '@card-game/protocol';
import { createGameApplication } from '@server/application';
import { buildCatalog } from '@server/catalog/catalog';
import { BuilderApi } from '@builder/api';
import { changeCopies, importDeck, exportDeck } from '@builder/model';
import { gameDeckUrl } from '@builder/handoff';
import { readDeckHandoff, ownedHandoffDeck } from '@client/deck-handoff';
import { declarationPlayer } from '@rules/turn-utils';

const password = 'copper lantern river orchard';
const deck: DeckInput = { name: 'Mountain servants', format: 'standard', cards: [{ cardId: 'land-red', quantity: 56 }, { cardId: 'empire-servant', quantity: 4 }] };

describe('Milestone 3 HTTP and short saved-deck match', () => {
  let directory: string, filename: string, app: ReturnType<typeof createGameApplication> | undefined, url: string;
  const sockets: Socket[] = [];
  async function start() {
    app = createGameApplication({ databasePath: filename, environment: { NODE_ENV: 'production', ALLOWED_ORIGINS: 'http://localhost:3000', DELTA_LOG_PATH: '', INSPECTOR_ENABLED: 'true' } });
    await app.ready;
    await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('Missing address'); url = `http://127.0.0.1:${address.port}`;
  }
  async function stop() { sockets.splice(0).forEach(socket => socket.disconnect()); if (app) await new Promise<void>(resolve => app!.io.close(() => resolve())); app = undefined; }
  beforeEach(async () => { directory = mkdtempSync(join(tmpdir(), 'card-game-m3-api-')); filename = join(directory, 'game.sqlite'); await start(); });
  afterEach(async () => { await stop(); rmSync(directory, { recursive: true, force: true }); });
  const request = (path: string, method = 'GET', token?: string, body?: unknown) => fetch(url + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  async function register(username: string) {
    const response = await request('/api/auth/register', 'POST', undefined, { protocolVersion: 1, username, password });
    expect(response.status).toBe(201); return AuthResponseSchema.parse(await response.json());
  }
  async function save(token: string, input = deck) {
    return new BuilderApi((resource, init) => fetch(url + resource, init)).save(token, input);
  }
  function once<T>(socket: Socket, event: string, accepts: (value: T) => boolean = () => true): Promise<T> {
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); socket.off(event, listener); if (event !== 'error') socket.off('error', failed); };
      const listener = (value: T) => { if (!accepts(value)) return; cleanup(); resolve(value); };
      const failed = (value: { message: string }) => { cleanup(); reject(new Error('Server rejected command: ' + value.message)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out: ' + event)); }, 2000);
      socket.on(event, listener);
      if (event !== 'error') socket.on('error', failed);
    });
  }
  async function client(session: AuthResponse) {
    const socket = connect(url, { transports: ['websocket'], autoConnect: false, reconnection: false, auth: { protocolVersion: 1, token: session.token } }); sockets.push(socket);
    let view: PlayerView | undefined;
    socket.on('roomSnapshot', data => { view = data.room; });
    const ready = once(socket, 'sessionReady'); socket.connect(); await ready;
    return { socket, view: () => view };
  }
  async function create(player: Awaited<ReturnType<typeof client>>, deckId: string) {
    const result = once<{ roomId: string }>(player.socket, 'roomCreated');
    player.socket.emit('createRoom', { protocolVersion: 1, deckId }); return (await result).roomId;
  }

  it('pages public catalog DTOs and rejects unbounded/unknown query fields', async () => {
    const first = CatalogResponseSchema.parse(await (await request('/api/cards?limit=2')).json());
    const second = CatalogResponseSchema.parse(await (await request('/api/cards?offset=2&limit=2')).json());
    expect(first.cards).toHaveLength(2); expect(second.cards).toHaveLength(2); expect(first.total).toBe(buildCatalog().size);
    expect(new Set([...first.cards, ...second.cards].map(card => card.id)).size).toBe(4);
    for (const query of ['limit=101', 'offset=-1', 'limit=1&ownerId=other']) expect((await request('/api/cards?' + query)).status).toBe(400);
  });

  it('enforces ownership for every deck operation and preserves shared validation errors', async () => {
    const a = await register('alice'), b = await register('bob'), saved = await save(a.token);
    const page = DeckListResponseSchema.parse(await (await request('/api/decks', 'GET', b.token)).json()); expect(page.decks).toEqual([]); expect(page.total).toBe(0);
    for (const method of ['GET', 'PUT', 'DELETE']) expect((await request('/api/decks/' + saved.id, method, b.token, method === 'PUT' ? { protocolVersion: 1, deck } : undefined)).status).toBe(404);
    const invalid = { ...deck, cards: [{ cardId: 'land-red', quantity: 55 }, { cardId: 'empire-servant', quantity: 5 }] };
    const validation = validateDeck(invalid, buildCatalog()); expect(validation.valid).toBe(false);
    const browserCatalog = new Map((await new BuilderApi((resource, init) => fetch(url + resource, init)).catalog()).map(card => [card.id, card]));
    expect(validateDeck(invalid, browserCatalog)).toEqual(validation);
    const rejected = await request('/api/decks/' + saved.id, 'PUT', a.token, { protocolVersion: 1, deck: invalid });
    expect(rejected.status).toBe(400); expect(await rejected.json()).toEqual({ protocolVersion: 1, message: 'Deck is invalid.', issues: !validation.valid && validation.issues });
    expect((await request('/api/decks', 'POST', a.token, { protocolVersion: 1, deck, ownerId: b.account!.id })).status).toBe(400);
    const name = "Robert'); DROP TABLE accounts;--";
    const updated = await request('/api/decks/' + saved.id, 'PUT', a.token, { protocolVersion: 1, deck: { ...deck, name } });
    expect(updated.status).toBe(200); expect(DeckResponseSchema.parse(await updated.json()).deck.name).toBe(name);
    expect((await request('/api/auth/me', 'GET', b.token)).status).toBe(200);
    expect((await request('/api/decks/not-a-uuid', 'GET', a.token)).status).toBe(404);
    expect((await request('/api/decks?limit=101', 'GET', a.token)).status).toBe(400);
    expect((await request('/api/decks/' + saved.id, 'DELETE', a.token)).status).toBe(204);
    expect((await request('/api/decks/' + saved.id, 'GET', a.token)).status).toBe(404);
  });

  it('denies unauthenticated, guest and admin-scoped deck management and unauthenticated ownership claims', async () => {
    expect((await request('/api/decks')).status).toBe(401);
    expect((await request('/api/decks', 'POST', undefined, { protocolVersion: 1, deck })).status).toBe(401);
    const guest = AuthResponseSchema.parse(await (await request('/api/auth/guest', 'POST', undefined, { protocolVersion: 1 })).json());
    expect((await request('/api/decks', 'GET', guest.token)).status).toBe(403);
    await expect(new BuilderApi((resource, init) => fetch(url + resource, init)).save(guest.token, deck)).rejects.toMatchObject({ status: 403 });
    await app!.auth.bootstrapAdmin('operator', password);
    const admin = AuthResponseSchema.parse(await (await request('/api/auth/login', 'POST', undefined, { protocolVersion: 1, username: 'operator', password, scope: 'admin' })).json());
    expect((await request('/api/decks', 'POST', admin.token, { protocolVersion: 1, deck })).status).toBe(403);
    expect((await request('/api/admin/me', 'GET', admin.token)).status).toBe(200);
    const player = await client(guest), error = once<{ message: string }>(player.socket, 'error');
    player.socket.emit('createRoom', { protocolVersion: 1 }); expect((await error).message).toContain('Select an owned'); expect(app!.store.listRooms()).toEqual([]);
  });

  it('survives an application restart while rooms disappear and logout remains revoked', async () => {
    const session = await register('alice'), saved = await save(session.token), player = await client(session);
    const roomId = await create(player, saved.id); expect(app!.store.getRoom(roomId)).toBeDefined();
    await stop(); await start();
    expect((await request('/api/auth/me', 'GET', session.token)).status).toBe(200);
    expect(DeckResponseSchema.parse(await (await request('/api/decks/' + saved.id, 'GET', session.token)).json()).deck).toEqual(saved);
    expect(app!.store.listRooms()).toEqual([]); expect(app!.auth.repository.ownedSeat(roomId, 'account:' + session.account!.id)).toBeUndefined();
    expect((await request('/api/auth/logout', 'POST', session.token, { protocolVersion: 1 })).status).toBe(200);
    await stop(); await start(); expect((await request('/api/auth/me', 'GET', session.token)).status).toBe(401);
  });

  it('builds/imports through the builder, saves and hands off owned decks, then plays a complete turn with private snapshots', async () => {
    let a = await register('alice'); const b = await register('bob');
    const builder = new BuilderApi((resource, init) => fetch(url + resource, init));
    const publicCards = await builder.catalog(), builderCatalog = new Map(publicCards.map(card => [card.id, card]));
    const draft = changeCopies(importDeck(exportDeck({ ...deck, cards: [{ cardId: 'land-red', quantity: 55 }, { cardId: 'empire-servant', quantity: 4 }] })), 'land-red', 1);
    expect(validateDeck(draft, builderCatalog)).toEqual(validateDeck(draft, buildCatalog()));
    expect(validateDeck(draft, builderCatalog).valid).toBe(true);
    const aDeck = await save(a.token, draft), bDeck = await save(b.token, { ...deck, name: 'Wolves', cards: [{ cardId: 'land-red', quantity: 56 }, { cardId: 'red-wolf', quantity: 4 }] });
    const handoff = readDeckHandoff(new URL(gameDeckUrl('https://game.example/', aDeck.id)).search);
    expect(ownedHandoffDeck(handoff, await builder.decks(b.token))).toBeUndefined();
    const selected = ownedHandoffDeck(handoff, await builder.decks(a.token)); expect(selected?.id).toBe(aDeck.id);
    const builderToken = a.token;
    a = await builder.authenticate('login', 'alice', password);
    expect(a.token).not.toBe(builderToken);
    expect((await request('/api/auth/me', 'GET', builderToken)).status).toBe(401);
    expect(ownedHandoffDeck(handoff, await builder.decks(a.token))?.id).toBe(selected!.id);
    const p1 = await client(a), p2 = await client(b);
    let error = once<{ message: string }>(p2.socket, 'error'); p2.socket.emit('createRoom', { protocolVersion: 1, deckId: aDeck.id }); expect((await error).message).toBe('Deck not found.');
    error = once(p1.socket, 'error'); p1.socket.emit('createRoom', { protocolVersion: 1, deckId: aDeck.id, cards: ['land-red'] }); expect((await error).message).toContain('Invalid');
    const roomId = await create(p1, selected!.id);
    const captured = [...app!.store.getRoom(roomId)!.setup!.playerDecks![a.playerId]];
    expect((await request('/api/decks/' + aDeck.id, 'PUT', a.token, { protocolVersion: 1, deck: { ...deck, cards: [{ cardId: 'land-red', quantity: 60 }] } })).status).toBe(200);
    error = once(p2.socket, 'error'); p2.socket.emit('joinRoom', { protocolVersion: 1, roomId, deckId: aDeck.id }); expect((await error).message).toBe('Deck not found.');
    const joined = once(p2.socket, 'roomJoined'); p2.socket.emit('joinRoom', { protocolVersion: 1, roomId, deckId: bDeck.id }); await joined;
    expect((await request('/api/decks/' + bDeck.id, 'DELETE', b.token)).status).toBe(204);
    await vi.waitFor(() => expect(p2.view()?.status).toBe('RPS'));
    for (const [player, session] of [[p1, a], [p2, b]] as const) {
      const rock = player.view()!.players[session.playerId].hand.find(card => card.definitionId === 'rock')!;
      const delta = once(player.socket, 'stateDelta'); player.socket.emit('playerAction', { protocolVersion: 1, roomId, actionId: 'rpsPlay', cardUuid: rock.uuid }); await delta;
    }
    await vi.waitFor(() => expect(p1.view()?.status).toBe('playing'));
    const authoritative = () => app!.store.getRoom(roomId)!;
    expect(authoritative().setup!.playerDecks![a.playerId]).toEqual(captured);
    for (const [session, creature] of [[a, 'empire-servant'], [b, 'red-wolf']] as const) {
      const state = authoritative().players[session.playerId], cards = [...state.hand, ...state.deck].map(card => card.blueprint.id);
      expect(cards).toHaveLength(60); expect(cards.filter(id => id === creature)).toHaveLength(4); expect(cards.filter(id => id === 'land-red')).toHaveLength(56);
    }
    expect(p1.view()!.players[b.playerId].hand).toEqual([]); expect(JSON.stringify(p1.view())).not.toContain('playerDecks');
    for (let i = 0; authoritative().phase !== 'stateMainPhase' && i < 12; i++) {
      const player = authoritative().priorityPlayerId === a.playerId ? p1 : p2, commandId = randomUUID();
      const delta = once<{ commandId?: string }>(player.socket, 'stateDelta', value => value.commandId === commandId);
      player.socket.emit('playerAction', { protocolVersion: 1, roomId, actionId: 'pass_priority', commandId }); await delta;
    }
    expect(authoritative().phase).toBe('stateMainPhase');
    const active = authoritative().activeTurnPlayerId, player = active === a.playerId ? p1 : p2;
    const land = authoritative().players[active].hand.find(card => card.blueprint.id === 'land-red')!;
    const delta = once(player.socket, 'stateDelta'); player.socket.emit('playerAction', { protocolVersion: 1, roomId, actionId: 'play_land', cardUuid: land.uuid, zoneRevision: land.state.zoneRevision ?? 0 }); await delta;
    expect(authoritative().battlefield.some(card => card.uuid === land.uuid && card.state.ownerId === active)).toBe(true);
    const initialTurn = authoritative().turnNumber!;
    for (let i = 0; authoritative().activeTurnPlayerId === active && i < 30; i++) {
      const declaring = declarationPlayer(authoritative());
      const acting = (declaring ?? authoritative().priorityPlayerId) === a.playerId ? p1 : p2, commandId = randomUUID();
      const advanced = once<{ commandId?: string }>(acting.socket, 'stateDelta', value => value.commandId === commandId);
      const action = declaring ? authoritative().phase === 'declareAttackersStep' ? { actionId: 'declare_attackers', attackers: [] } : { actionId: 'declare_blockers', assignments: [] } : { actionId: 'pass_priority' };
      acting.socket.emit('playerAction', { protocolVersion: 1, roomId, ...action, commandId }); await advanced;
    }
    expect(authoritative().activeTurnPlayerId).not.toBe(active);
    expect(authoritative().turnNumber).toBe(initialTurn + 1);
  });
});
