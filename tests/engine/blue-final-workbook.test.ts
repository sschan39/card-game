import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { CardCharacteristicService } from '@engine/card-characteristic-service';
import { instantiateCard } from '@library/card-factory';
import { actionPermission } from '@rules/action-permissions';
import { targetPermissionsAllow } from '@rules/target-legality';
import { buildPlayerView } from '@server/projection/view-builder';
import type { CardInstance, CardZone } from '@shared/card.types';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';

const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));

function card(id: string, zone: CardZone, player = 'player1') {
  const value = instantiateCard(id);
  value.state = { ...value.state, zone, ownerId: player, controllerId: player, summoningSickness: false };
  return value;
}
function game(battlefield: CardInstance[] = [], random = () => 0) {
  const room = createTestRoom({ battlefield });
  fillTestLibraries(room, 20);
  room.players.player1.hand = [];
  const engine = new GameEngine(room, { random });
  engines.push(engine);
  engine.initRoom();
  return engine;
}
function resolve(engine: GameEngine) {
  expect(engine.resolveTopOfStack().success).toBe(true);
}
function activate(engine: GameEngine, source: CardInstance, abilityId: string, playerId = 'player1') {
  return engine.executePlayerAction(playerId, 'activate_ability', { cardUuid: source.uuid, abilityId });
}
function choose(engine: GameEngine, selections: string[]) {
  const choice = engine.roomState.pendingChoice;
  expect(choice).toBeTruthy();
  expect(engine.executePlayerAction(choice!.playerId, 'choose', { choiceId: choice!.id, choices: selections }).success).toBe(true);
}
function cast(engine: GameEngine, source: CardInstance, playerId = 'player1') {
  const room = engine.roomState;
  room.priorityPlayerId = playerId;
  return engine.executePlayerAction(playerId, 'cast_spell', { cardUuid: source.uuid });
}
const ids = (cards: CardInstance[]) => cards.map(item => item.uuid);

describe('final blue workbook cards', () => {
  it('Lokinia takes a revealed opposing creature into your hand and discards only the remainder', () => {
    const temple = card('shifting-sea-temple', 'battlefield');
    const engine = game([temple]);
    const source = card('shifting-sea-lokinia', 'hand');
    const outside = card('sea-patrol', 'library', 'player2');
    const taken = card('sea-patrol', 'library', 'player2');
    const rest = Array.from({ length: 5 }, () => card('sea-domain', 'library', 'player2'));
    engine.roomState.players.player1.hand.push(source);
    engine.roomState.players.player2.deck = [outside, taken, ...rest];
    expect(cast(engine, source).success).toBe(true);
    resolve(engine);
    resolve(engine);
    choose(engine, ['reveal-six']);
    choose(engine, [taken.uuid]);

    const room = engine.roomState;
    expect(ids(room.players.player1.hand)).toEqual([taken.uuid]);
    expect(ids(room.players.player2.deck)).toEqual([outside.uuid]);
    expect(new Set(ids(room.players.player2.graveyard))).toEqual(new Set(ids(rest)));
    const held = room.players.player1.hand[0];
    expect(held.state).toMatchObject({ ownerId: 'player2', handHolderId: 'player1', controllerId: 'player1' });
    expect(buildPlayerView(room, 'player1').players.player1.hand[0].actions).not.toEqual([]);
    expect(buildPlayerView(room, 'player2').players.player1.hand).toEqual([]);

    engine.applyMutations([{
      type: 'MOVE_CARD', cardUuid: taken.uuid, playerId: 'player1', from: 'hand', to: 'graveyard',
      zoneRevision: held.state.zoneRevision, reason: 'discard',
    }]);
    expect(ids(engine.roomState.players.player2.graveyard)).toContain(taken.uuid);
    expect(engine.roomState.players.player1.hand).toHaveLength(0);
  });

  it('the holder can cast a borrowed creature immediately and keeps its owner separate', () => {
    const host = card('sea-patrol', 'battlefield');
    host.blueprint = { ...host.blueprint, keywords: ['ImmediateFriendlyCreatures'] };
    const engine = game([host]);
    const borrowed = card('sea-patrol', 'library', 'player2');
    engine.roomState.players.player2.deck.push(borrowed);
    engine.applyMutations([{
      type: 'MOVE_CARD', cardUuid: borrowed.uuid, playerId: 'player2', handRecipientId: 'player1',
      from: 'library', to: 'hand',
    }]);
    expect(cast(engine, borrowed).success).toBe(true);
    const live = engine.roomState.battlefield.find(item => item.uuid === borrowed.uuid);
    expect(live?.state).toMatchObject({ ownerId: 'player2', controllerId: 'player1', summonKind: 'cast' });
    expect(live?.state.handHolderId).toBeUndefined();
  });

  it('Lokinia’s optional attack mills for the number of opposing creatures', () => {
    const source = card('shifting-sea-lokinia', 'battlefield');
    const engine = game([source, card('sea-patrol', 'battlefield', 'player2'), card('sea-patrol', 'battlefield', 'player2'),
      card('sea-domain', 'battlefield', 'player2'), card('sea-patrol', 'battlefield')]);
    engine.roomState.phase = 'declareAttackersStep';
    engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] }).success).toBe(true);
    resolve(engine);
    choose(engine, ['yes']);
    expect(engine.roomState.players.player2.graveyard).toHaveLength(2);
  });

  it('Eternal Sea holds the exact public face and blocks same-name land play, activation and deployment across zones', () => {
    const sea = card('eternal-sea', 'battlefield');
    const onBoard = card('azure-sea-emperor-loki', 'battlefield', 'player2');
    const engine = game([sea, onBoard]);
    const shown = card('azure-sea-emperor-loki', 'hand', 'player2');
    const other = card('sea-patrol', 'hand', 'player2');
    const libraryCopy = card('azure-sea-emperor-loki', 'library', 'player2');
    const graveCopy = card('azure-sea-emperor-loki', 'graveyard', 'player2');
    engine.roomState.players.player2.hand = [shown, other];
    engine.roomState.players.player2.deck.push(libraryCopy);
    engine.roomState.players.player2.graveyard.push(graveCopy);

    expect(activate(engine, sea, 'reveal-and-lock-name').success).toBe(true);
    resolve(engine);
    const view = buildPlayerView(engine.roomState, 'player1');
    expect(view.players.player2.hand).toEqual([]);
    expect(view.observations?.active.flatMap(item => item.cards?.map(value => value.name) ?? [])).toEqual([shown.blueprint.name]);
    expect(view.publicNameLocks).toEqual([{ name: shown.blueprint.name, playerId: 'player2' }]);
    expect(JSON.stringify(view.observations)).not.toContain(shown.uuid);

    let room = engine.roomState;
    room.activeTurnPlayerId = 'player2';
    room.priorityPlayerId = 'player2';
    expect(engine.executePlayerAction('player2', 'play_land', { cardUuid: shown.uuid, zoneRevision: 0 }).success).toBe(false);
    expect(engine.executePlayerAction('player2', 'tapForMana', { cardUuid: onBoard.uuid, abilityId: 'produce-blue' }).success).toBe(false);
    for (const copy of [libraryCopy, graveCopy]) {
      expect(actionPermission(engine.roomState, 'player2', copy, 'activate').allowed).toBe(false);
      engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: copy.uuid, playerId: 'player2', from: copy.state.zone, to: 'battlefield' }]);
      expect(ids(engine.roomState.battlefield)).not.toContain(copy.uuid);
    }

    engine.applyMutations([{
      type: 'MOVE_CARD', cardUuid: libraryCopy.uuid, playerId: 'player2', from: 'library', to: 'battlefield',
      controllerId: 'player1', cause: { id: 'locked-deploy', rootId: 'locked-deploy', kind: 'effect', controllerId: 'player2' },
    }]);
    expect(ids(engine.roomState.battlefield)).not.toContain(libraryCopy.uuid);
    expect(cast(engine, other, 'player2').success).toBe(true);
    resolve(engine);
    if (engine.roomState.pendingChoice?.kind === 'ordering') {
      choose(engine, engine.roomState.pendingChoice.options.map(option => option.id));
    }
    while (engine.roomState.stack.length) resolve(engine);
    room = engine.roomState;
    expect(room.battlefield.find(value => value.uuid === onBoard.uuid)?.state.counters.charge).toBe(1);
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: sea.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: shown.uuid, playerId: 'player2', from: 'hand', to: 'library' },
    ]);
    const after = buildPlayerView(engine.roomState, 'player1');
    expect(after.observations?.active).toEqual([]);
    expect(after.observations?.history.flatMap(item => item.cards?.map(value => value.name) ?? [])).toContain(shown.blueprint.name);
    expect(after.publicNameLocks).toEqual(view.publicNameLocks);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(buildPlayerView(engine.roomState, 'player1').publicNameLocks).toBeUndefined();
    expect(actionPermission(engine.roomState, 'player2', graveCopy, 'deploy').allowed).toBe(true);
  });

  it('Eternal Sea blocks a same-name cast and removes an active hand reveal at cleanup', () => {
    const sea = card('eternal-sea', 'battlefield');
    const engine = game([sea]);
    const chosen = card('sea-patrol', 'hand', 'player2');
    engine.roomState.players.player2.hand = [chosen, card('sea-patrol', 'hand', 'player2')];
    expect(activate(engine, sea, 'reveal-and-lock-name').success).toBe(true);
    resolve(engine);
    engine.roomState.activeTurnPlayerId = 'player2';
    expect(cast(engine, chosen, 'player2').success).toBe(false);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    const after = buildPlayerView(engine.roomState, 'player1');
    expect(after.observations?.active).toEqual([]);
    expect(after.observations?.history[0]?.cards?.[0]?.name).toBe(chosen.blueprint.name);
    expect(cast(engine, chosen, 'player2').success).toBe(true);
  });

  it.each([4, 5])('Deep Sea Tomb checks %s cards for opposing hand effects and protects graveyard targets', count => {
    const tomb = card('deep-sea-tomb', 'battlefield', 'player2');
    const jorm = card('sea-god-wrath-jormungandr', 'battlefield');
    const sea = card('eternal-sea', 'battlefield');
    const random = vi.fn(() => 0);
    const engine = game([tomb, jorm, sea], random);
    const cards = Array.from({ length: count }, () => card('sea-patrol', 'hand', 'player2'));
    engine.roomState.players.player2.hand = cards;
    const grave = card('sea-patrol', 'graveyard');
    engine.roomState.players.player1.graveyard.push(grave);
    const target = { targetType: 'card' as const, cardUuid: grave.uuid, zone: 'graveyard' as const, zoneRevision: 0 };
    expect(targetPermissionsAllow(engine.roomState, 'player1', jorm, target)).toBe(false);
    expect(targetPermissionsAllow(engine.roomState, 'player2', tomb, target)).toBe(false);
    expect(actionPermission(engine.roomState, 'player2', cards[0], 'affect').allowed).toBe(true);

    expect(activate(engine, sea, 'reveal-and-lock-name').success).toBe(true);
    resolve(engine);
    expect(random).toHaveBeenCalledTimes(count === 5 ? 1 : 0);
    expect(buildPlayerView(engine.roomState, 'player1').publicNameLocks?.length ?? 0).toBe(count === 5 ? 1 : 0);
    engine.roomState.priorityPlayerId = 'player1';
    expect(activate(engine, jorm, 'random-hand-discard').success).toBe(true);
    resolve(engine);
    expect(engine.roomState.players.player2.hand).toHaveLength(4);
    engine.applyMutations([{
      type: 'MOVE_CARD', cardUuid: engine.roomState.players.player2.hand[0].uuid, playerId: 'player2',
      from: 'hand', to: 'exile', cause: { id: 'test-move', rootId: 'test-move', kind: 'effect', controllerId: 'player1' },
    }]);
    expect(engine.roomState.players.player2.hand).toHaveLength(4);
  });

  it('Loki draws for the recipient and substitutes blue for both colors on that exact card only', () => {
    const loki = card('azure-sea-emperor-loki', 'battlefield');
    loki.state.counters.charge = 4;
    const engine = game([loki]);
    const taken = card('sea-patrol', 'library', 'player2');
    taken.blueprint = { ...taken.blueprint, colors: ['red', 'green'], castRequirements: {
      ...taken.blueprint.castRequirements, cost: { mana: { red: 2, green: 1, generic: 1 } },
    } };
    const twin = card('sea-patrol', 'hand');
    twin.blueprint = taken.blueprint;
    engine.roomState.players.player1.hand = [twin];
    engine.roomState.players.player1.mana = { red: 0, green: 0, white: 0, black: 0, yellow: 0, blue: 4 };
    engine.roomState.players.player2.deck.push(taken);
    expect(activate(engine, loki, 'draw-opposing-card').success).toBe(true);
    resolve(engine);
    const room = engine.roomState;
    const held = room.players.player1.hand.find(item => item.uuid === taken.uuid)!;
    expect(held.state).toMatchObject({ ownerId: 'player2', handHolderId: 'player1' });
    expect(CardCharacteristicService.resolveManaCost(room, held)).toEqual({ red: 2, green: 1, generic: 1 });
    const option = buildPlayerView(room, 'player1').players.player1.hand
      .find(item => item.uuid === held.uuid)?.actions.find(action => action.actionId === 'cast_spell');
    expect(option).toMatchObject({ disabled: false, description: expect.stringContaining('pay red or green with blue') });
    expect(room.battlefield.find(item => item.uuid === loki.uuid)?.state.counters.charge ?? 0).toBe(0);
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.find(event => event.eventId === 'CARD_DRAWN')?.payload).toMatchObject({ playerId: 'player1' });
    expect(buildPlayerView(room, 'player2').observations?.history[0]?.cards?.[0]?.name).toBe(taken.blueprint.name);
    expect(cast(engine, twin).success).toBe(false);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: held.uuid, payment: { blue: 4 } }).success).toBe(true);
    resolve(engine);
    expect(engine.roomState.battlefield.find(item => item.uuid === taken.uuid)?.state)
      .toMatchObject({ ownerId: 'player2', controllerId: 'player1' });
    expect(engine.roomState.players.player1.mana.blue).toBe(0);
  });

  it('Loki reveals only a successful draw and the permission expires even if the drawn card stays in hand', () => {
    const loki = card('azure-sea-emperor-loki', 'battlefield');
    loki.state.counters.charge = 8;
    const engine = game([loki]);
    const taken = card('sea-patrol', 'library', 'player2');
    taken.blueprint = { ...taken.blueprint, colors: ['red'], castRequirements: {
      ...taken.blueprint.castRequirements, cost: { mana: { red: 1 } },
    } };
    engine.roomState.players.player1.mana = { red: 0, green: 0, white: 0, black: 0, yellow: 0, blue: 1 };
    engine.roomState.players.player2.deck.push(taken);
    engine.roomState.replacementEffects = [{
      id: 'cancel-draw', label: 'Cancel draw', optional: true, uses: 1,
      match: { kinds: ['draw'], playerId: 'player1' }, operation: { type: 'cancel_event' },
    }];
    expect(activate(engine, loki, 'draw-opposing-card').success).toBe(true);
    resolve(engine);
    choose(engine, ['cancel-draw']);
    expect(engine.roomState.players.player1.hand).toHaveLength(0);
    expect(engine.roomState.players.player2.deck.at(-1)?.uuid).toBe(taken.uuid);
    expect(buildPlayerView(engine.roomState, 'player2').observations?.history.flatMap(item => item.cards ?? [])).toEqual([]);
    engine.roomState.priorityPlayerId = 'player1';
    expect(activate(engine, loki, 'draw-opposing-card').success).toBe(true);
    resolve(engine);
    const held = engine.roomState.players.player1.hand[0];
    expect(CardCharacteristicService.castManaSubstitution(engine.roomState, held, 'player1')).toMatchObject({ from: 'blue', colors: ['red'] });
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(cast(engine, held).success).toBe(false);
    expect(ids(engine.roomState.players.player1.hand)).toEqual([taken.uuid]);
  });
});
