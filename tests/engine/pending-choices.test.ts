import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { instantiateCard } from '../../src/library/card-factory';
import type { EffectDefinition, EffectChoice } from '../../src/types/effect.types';
import { OptionService } from '../../src/engine/option-service';
import { normalizeAbility } from '../../src/library/card-parser';
import { choiceCanComplete } from '../../src/engine/choices';

const gain = (amount: number): EffectDefinition => ({ action: 'MODIFY_LIFE', params: { amount }, targeting: { type: 'self', required: false } });
function fixture(effects: EffectDefinition[] = []) {
  const room = createTestRoom(); const card = room.players.player1.hand[0];
  card.blueprint = { ...card.blueprint, cardTypes: ['Spell'], onCastEffects: effects, castRequirements: { allowedZones: ['hand'], speed: 'instant', cost: { mana: { red: 1 } } } };
  registerAction('cast_spell', playCardHandler); const engine = new GameEngine(room); engine.initRoom();
  return { engine, card };
}
function answer(engine: GameEngine, choices: string[], player = 'player1') {
  return engine.executePlayerAction(player, 'choose', { choiceId: engine.roomState.pendingChoice?.id, choices });
}

describe('room-owned pending choices', () => {
  it.each(['top', 'bottom'] as const)('orders a searched subset at the %s and resumes serialized instructions once', placement => {
    const { engine, card } = fixture([gain(1), {
      action: 'REORDER_LIBRARY', params: { placement }, targeting: { type: 'self', required: false },
      choice: { kind: 'search', zone: 'library', min: 2, max: 2, ordered: true },
    }, gain(3), { action: 'DRAW', params: { amount: placement === 'top' ? 2 : 4 }, targeting: { type: 'self', required: false } }]);
    const cards = Array.from({ length: 4 }, () => instantiateCard('land-red'));
    cards.forEach(c => { c.state.ownerId = c.state.controllerId = 'player1'; });
    engine.roomState.players.player1.deck = cards;
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    const request = engine.roomState.pendingChoice!;
    expect(request).toMatchObject({ kind: 'ordering', min: 2, max: 2, playerId: 'player1' });
    expect(request.prompt).toContain('2'); expect(request.prompt).toContain('top-to-bottom');
    expect(request.options.map(option => option.value)).toEqual(cards.map(c => ({ targetType: 'card', cardUuid: c.uuid, zone: 'library', zoneRevision: 0 })));
    expect(request.continuation.type === 'resolution' && request.continuation.stackObj.effects[request.continuation.effectIndex].choice?.kind).toBe('search');
    const before = structuredClone(engine.roomState);
    for (const choices of [[cards[0].uuid, cards[0].uuid], ['unknown', cards[0].uuid], [cards[0].uuid], [cards[0].uuid, cards[1].uuid, cards[2].uuid]]) {
      expect(answer(engine, choices).success).toBe(false); expect(engine.roomState).toEqual(before);
    }
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: 'stale', choices: [cards[0].uuid, cards[1].uuid] }).success).toBe(false);
    expect(engine.roomState).toEqual(before);
    const recovered = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); engine.dispose(); recovered.initRoom();
    expect(answer(recovered, [cards[1].uuid, cards[3].uuid]).success).toBe(true);
    expect(recovered.roomState.players.player1.hand.map(c => c.uuid)).toEqual(placement === 'top'
      ? [cards[1].uuid, cards[3].uuid] : [cards[2].uuid, cards[0].uuid, cards[1].uuid, cards[3].uuid]);
    expect(recovered.roomState.players.player1.life).toBe(24); expect(recovered.roomState.players.player1.mana.red).toBe(4);
    expect(recovered.roomState.pendingChoice).toBeNull(); expect(recovered.roomState.stack).toEqual([]);
    expect(recovered.roomState.priorityPlayerId).toBe('player1'); recovered.dispose();
  });
  it.each([false, true])('keeps live ordered survivors when a selected identity returns (all stale: %s)', allStale => {
    const { engine, card } = fixture([{
      action: 'REORDER_LIBRARY', params: { placement: 'top' }, targeting: { type: 'self', required: false },
      choice: { kind: 'search', zone: 'library', min: 3, max: 3, ordered: true },
    }, gain(1)]);
    const cards = Array.from({ length: 4 }, () => instantiateCard('land-red'));
    cards.forEach(c => { c.state.ownerId = c.state.controllerId = 'player1'; }); engine.roomState.players.player1.deck = cards;
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    expect(engine.roomState.pendingChoice?.kind).toBe('ordering');
    for (const c of allStale ? cards.slice(0, 3) : [cards[1]]) {
      engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: c.uuid, playerId: 'player1', from: 'library', to: 'exile' }]);
      engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: c.uuid, playerId: 'player1', from: 'exile', to: 'library', toIndex: cards.indexOf(c) }]);
      expect(engine.roomState.players.player1.deck.find(live => live.uuid === c.uuid)?.state.zoneRevision).toBe(2);
    }
    expect(answer(engine, [cards[2].uuid, cards[1].uuid, cards[0].uuid]).success).toBe(true);
    expect(engine.roomState.players.player1.deck.map(c => c.uuid)).toEqual(allStale ? cards.map(c => c.uuid) : [cards[1].uuid, cards[3].uuid, cards[0].uuid, cards[2].uuid]);
    expect(engine.roomState.players.player1.life).toBe(21); expect(engine.roomState.pendingChoice).toBeNull(); engine.dispose();
  });
  it.each([0, 1])('finishes an optional ordered search of %s cards in one answer', count => {
    const { engine, card } = fixture([{
      action: 'MOVE_ZONE', params: { destination: 'hand' }, targeting: { type: 'self', required: false },
      choice: { kind: 'search', zone: 'library', min: 0, max: 1, ordered: true, prompt: 'Custom direction' },
    }, gain(1)]);
    const land = instantiateCard('land-red'); land.state.ownerId = land.state.controllerId = 'player1'; engine.roomState.players.player1.deck = [land];
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    expect(engine.roomState.pendingChoice).toMatchObject({ kind: 'ordering', prompt: 'Custom direction', min: 0, max: 1 });
    expect(answer(engine, count ? [land.uuid] : []).success).toBe(true);
    expect(engine.roomState.players.player1.hand.map(c => c.uuid)).toEqual(count ? [land.uuid] : []);
    expect(engine.roomState.pendingChoice).toBeNull(); expect(engine.roomState.players.player1.life).toBe(21); engine.dispose();
  });
  it('rejects duplicate or empty option IDs before publishing a request', () => {
    for (const ids of [['same', 'same'], ['valid', '']]) {
      expect(choiceCanComplete({ kind: 'ordering', options: ids.map(id => ({ id, label: id, value: id })), min: 2, max: 2 })).toBe(false);
    }
  });
  it('prompts for modes before payment and revalidates the completed action', () => {
    const { engine, card } = fixture();
    card.blueprint = { ...card.blueprint, modes: [{ id: 'small', label: 'Gain two', effects: [gain(2)] }, { id: 'large', label: 'Gain four', effects: [gain(4)] }] };
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
    expect(engine.roomState.pendingChoice?.kind).toBe('modes'); expect(engine.roomState.players.player1.mana.red).toBe(5);
    expect(answer(engine, ['large']).success).toBe(true);
    expect(engine.roomState.pendingChoice).toBeNull(); expect(engine.roomState.players.player1.mana.red).toBe(4);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.life).toBe(24); engine.dispose();
  });
  it('prompts for target and discard selections without paying early', () => {
    const { engine, card } = fixture([{ action: 'MODIFY_LIFE', params: { amount: -1 }, targeting: { type: 'player', controller: 'opponent', required: true, maxTargets: 1 } }]);
    card.blueprint = { ...card.blueprint, castRequirements: { ...card.blueprint.castRequirements, cost: { mana: { red: 1 }, discard: 1 } } };
    const other = instantiateCard('land-red'); other.state = { ...other.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' }; engine.roomState.players.player1.hand.push(other);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
    expect(engine.roomState.pendingChoice?.kind).toBe('targets');
    expect(answer(engine, [engine.roomState.pendingChoice!.options[0].id]).success).toBe(true);
    expect(engine.roomState.pendingChoice?.kind).toBe('discard');
    expect(answer(engine, [other.uuid]).success).toBe(true);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toContain(other.uuid); engine.dispose();
  });
  it('pauses optional resolution, blocks other commands and resumes after serialization without replaying effects', () => {
    const { engine, card } = fixture([gain(1), { ...gain(2), choice: { kind: 'optional' } }, gain(3)]);
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(21);
    expect(engine.roomState.priorityPlayerId).toBeNull(); expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.roomState.pendingChoice?.kind).toBe('optional');
    expect(engine.executePlayerAction('player1', 'pass_priority', {}).success).toBe(false);
    expect(answer(engine, ['yes'], 'player2').success).toBe(false);
    const saved = JSON.parse(JSON.stringify(engine.roomState)); engine.dispose();
    const recovered = new GameEngine(saved); recovered.initRoom();
    expect(answer(recovered, ['yes']).success).toBe(true);
    expect(recovered.roomState.players.player1.life).toBe(26); expect(recovered.roomState.stack).toEqual([]);
    expect(recovered.roomState.priorityPlayerId).toBe('player1'); recovered.dispose();
  });
  it('validates search selections and moves the chosen library card', () => {
    const search: EffectChoice = { kind: 'search', zone: 'library', cardTypes: ['Land'], min: 0, max: 1 };
    const { engine, card } = fixture([{ action: 'MOVE_ZONE', params: { destination: 'hand' }, targeting: { type: 'self', required: false }, choice: search }]);
    const land = instantiateCard('land-red'); land.state.ownerId = land.state.controllerId = 'player1'; engine.roomState.players.player1.deck = [land];
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    const before = structuredClone(engine.roomState);
    expect(answer(engine, ['unknown']).success).toBe(false); expect(engine.roomState).toEqual(before);
    expect(answer(engine, [land.uuid]).success).toBe(true);
    expect(engine.roomState.players.player1.hand.map(c => c.uuid)).toContain(land.uuid); engine.dispose();
  });
  it('preserves chosen ordering of resolution branches', () => {
    const { engine, card } = fixture([{ ...gain(0), choice: { kind: 'ordering', options: [
      { id: 'first', label: 'Gain one', effects: [gain(1)] }, { id: 'second', label: 'Gain two', effects: [gain(2)] },
    ] } }]);
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    engine.drainEventBatches();
    expect(answer(engine, ['second', 'first']).success).toBe(true);
    expect(engine.drainEventBatches().flatMap(batch => batch.mutations).filter(m => m.type === 'SET_LIFE').map(m => m.type === 'SET_LIFE' && m.amount)).toEqual([22, 23]); engine.dispose();
  });
  it('validates exact distributions over the legal announced targets', () => {
    const { engine, card } = fixture([{ action: 'MODIFY_LIFE', params: { amount: -3 }, targeting: { type: 'player', required: true, maxTargets: 2 }, choice: { kind: 'distribution', total: 3 } }]);
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, targets: [{ targetType: 'player', playerId: 'player1' }, { targetType: 'player', playerId: 'player2' }] });
    const choice = engine.roomState.pendingChoice!;
    expect(choice?.kind).toBe('distribution'); expect(engine.roomState.stack).toEqual([]); expect(engine.roomState.players.player1.mana.red).toBe(5);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, allocations: { [choice.options[0].id]: 1, [choice.options[1].id]: 1 } }).success).toBe(false);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, allocations: { [choice.options[0].id]: 1, [choice.options[1].id]: 2 } }).success).toBe(true);
    expect(engine.roomState.pendingChoice).toBeNull(); expect(engine.roomState.stack).toHaveLength(1);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(19); expect(engine.roomState.players.player2.life).toBe(18); engine.dispose();
  });
  it('distributes an untargeted effect among the current matching permanents during resolution', () => {
    const { engine, card } = fixture([{ action: 'ADD_COUNTER', params: { amount: 3, counterType: 'charge' }, targeting: { type: 'permanent', all: true, required: false }, choice: { kind: 'distribution', total: 3 } }]);
    const lands = [instantiateCard('land-red'), instantiateCard('land-red')];
    lands.forEach(land => { land.state = { ...land.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' }; });
    engine.roomState.battlefield = lands;
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    const choice = engine.roomState.pendingChoice!;
    expect(choice.options.map(option => option.id)).toEqual(lands.map(land => 'permanent:' + land.uuid));
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, allocations: { [choice.options[0].id]: 1, [choice.options[1].id]: 2 } }).success).toBe(true);
    expect(engine.roomState.battlefield.map(land => land.state.counters.charge)).toEqual([1, 2]); engine.dispose();
  });
  it('rejects infeasible announced divisions without payment or an impossible prompt', () => {
    for (const [total, targets] of [[3, []], [1, ['player1', 'player2']]] as const) {
      const { engine, card } = fixture([{ action: 'MODIFY_LIFE', params: { amount: -total }, targeting: { type: 'player', minTargets: 0, maxTargets: 2, required: false }, choice: { kind: 'distribution', total } }]);
      const before = structuredClone(engine.roomState);
      expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, targets: targets.map(playerId => ({ targetType: 'player', playerId })) }).success).toBe(false);
      expect(engine.roomState).toEqual(before); engine.dispose();
    }
  });
  it('declines an optional instruction and continues with later instructions', () => {
    const { engine, card } = fixture([{ ...gain(7), choice: { kind: 'optional' } }, gain(1)]);
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    expect(answer(engine, ['no']).success).toBe(true);
    expect(engine.roomState.players.player1.life).toBe(21); engine.dispose();
  });
  it.each([false, true])('continues past an infeasible search (ordered: %s)', ordered => {
    const { engine, card } = fixture([{ action: 'MOVE_ZONE', params: { destination: 'hand' }, targeting: { type: 'self', required: false },
      choice: { kind: 'search', zone: 'library', min: 1, max: 1, ordered } }, gain(1)]);
    engine.roomState.players.player1.deck = [];
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    expect(engine.roomState.pendingChoice).toBeNull(); expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.players.player1.life).toBe(21); engine.dispose();
  });
  it('retains the selected zone and object revision for a resolution card selection', () => {
    const { engine, card } = fixture([{ action: 'MOVE_ZONE', params: { destination: 'hand' }, targeting: { type: 'self', required: false },
      choice: { kind: 'selection', criteria: { type: 'card', zones: ['graveyard'], required: true } } }]);
    const land = instantiateCard('land-red'); land.state = { ...land.state, zone: 'graveyard', zoneRevision: 2, ownerId: 'player1', controllerId: 'player1' };
    engine.roomState.players.player1.graveyard = [land];
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    expect(answer(engine, ['card:' + land.uuid]).success).toBe(true);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toContain(land.uuid); engine.dispose();
  });
  it('publishes typed choice lifecycle events for logging extensions', () => {
    const { engine, card } = fixture([{ ...gain(1), choice: { kind: 'optional' } }]);
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.drainEventBatches();
    engine.resolveTopOfStack(); const id = engine.roomState.pendingChoice!.id;
    const requested = engine.drainEventBatches().flatMap(batch => batch.events).find(event => event.eventId === 'CHOICE_REQUESTED');
    expect(requested?.payload).toMatchObject({ choiceId: id, playerId: 'player1', kind: 'optional' });
    answer(engine, ['yes']);
    const completed = engine.drainEventBatches().flatMap(batch => batch.events).find(event => event.eventId === 'CHOICE_COMPLETED');
    expect(completed?.payload).toMatchObject({ choiceId: id, playerId: 'player1' }); engine.dispose();
  });
  it('rejects stale requests and allows cancelling an unpaid announcement', () => {
    const { engine, card } = fixture(); card.blueprint.modes = [{ id: 'gain', label: 'Gain', effects: [gain(1)] }];
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid });
    const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: 'stale', choices: ['gain'] }).success).toBe(false);
    expect(engine.roomState).toEqual(before);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: before.pendingChoice!.id, cancel: true }).success).toBe(true);
    expect(engine.roomState.pendingChoice).toBeNull(); expect(engine.roomState.players.player1.mana.red).toBe(5); engine.dispose();
  });
  it('revalidates payment allocations without consuming the pending request', () => {
    const { engine, card } = fixture();
    engine.roomState.players.player1.mana.blue = 5;
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, choosePayment: true });
    const choice = engine.roomState.pendingChoice!;
    expect(choice.kind).toBe('payment');
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, allocations: { blue: 1 } }).success).toBe(false);
    expect(engine.roomState.pendingChoice?.id).toBe(choice.id);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, allocations: { red: 1 } }).success).toBe(true);
    expect(engine.roomState.players.player1.mana.red).toBe(4); engine.dispose();
  });
  it('preserves an optional decision inside a selected resolution option', () => {
    const { engine, card } = fixture([{ ...gain(0), choice: { kind: 'options', options: [{ id: 'gain', label: 'Gain life', effects: [
      { ...gain(2), choice: { kind: 'optional' } },
    ] }] } }]);
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    expect(answer(engine, ['gain']).success).toBe(true);
    expect(engine.roomState.pendingChoice?.kind).toBe('optional');
    expect(answer(engine, ['yes']).success).toBe(true);
    expect(engine.roomState.players.player1.life).toBe(22); engine.dispose();
  });
  it('rejects definitions that introduce actual targets only during resolution', () => {
    const { engine, card } = fixture([{ ...gain(0), choice: { kind: 'options', options: [{ id: 'hurt', label: 'Lose life', effects: [
      { action: 'MODIFY_LIFE', params: { amount: -2 }, targeting: { type: 'player', required: true } },
    ] }] } }]);
    const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(false);
    expect(engine.roomState).toEqual(before); engine.dispose();
  });
  it('preserves authored ability resolution choices during normalization', () => {
    expect(normalizeAbility({ id: 'optional', type: 'activated', effectId: 'MODIFY_LIFE', params: { amount: 1 }, choice: { kind: 'optional' } })?.effect.choice).toEqual({ kind: 'optional' });
    const search = { kind: 'search', zone: 'library', ordered: true, min: 1, max: 2 };
    expect(normalizeAbility({ id: 'search', type: 'activated', effectId: 'REORDER_LIBRARY', params: { placement: 'top' }, choice: search })?.effect.choice).toEqual(search);
  });
  it('settles state based actions only after an interrupted resolution finishes', () => {
    const { engine, card } = fixture([gain(-20), { ...gain(2), choice: { kind: 'optional' } }]);
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(0); expect(engine.roomState.status).toBe('playing');
    expect(answer(engine, ['yes']).success).toBe(true);
    expect(engine.roomState.players.player1.life).toBe(2); expect(engine.roomState.status).toBe('playing'); engine.dispose();
  });
  it('retains discovered triggers across serialized resolution pauses', () => {
    const { engine, card } = fixture([
      { action: 'MOVE_ZONE', params: { destination: 'battlefield' }, targeting: { type: 'self', required: false }, choice: { kind: 'search', zone: 'library', min: 1, max: 1 } },
      { ...gain(2), choice: { kind: 'optional' } },
    ]);
    const land = instantiateCard('land-red'); land.state.ownerId = land.state.controllerId = 'player1';
    land.blueprint = { ...land.blueprint, onEnterEffects: [gain(1)] }; engine.roomState.players.player1.deck = [land];
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    answer(engine, [land.uuid]);
    expect(engine.roomState.pendingTriggers?.length).toBeGreaterThan(0); expect(engine.roomState.stack).toHaveLength(1);
    const recovered = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); recovered.initRoom(); engine.dispose();
    expect(answer(recovered, ['yes']).success).toBe(true);
    expect(recovered.roomState.stack).toHaveLength(1); expect(recovered.roomState.stack[0].type).toBe('triggered');
    expect(recovered.roomState.pendingTriggers).toEqual([]);
    recovered.resolveTopOfStack(); expect(recovered.roomState.players.player1.life).toBe(23); recovered.dispose();
  });
  it('collects discard costs for a mana ability used during payment without paying early', () => {
    const { engine, card } = fixture();
    card.blueprint.castRequirements = { ...card.blueprint.castRequirements, cost: { mana: { red: 6 } } };
    const land = instantiateCard('land-red'); land.state = { ...land.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
    const ability = land.blueprint.abilities.find(a => a.type === 'activated')!;
    land.blueprint = { ...land.blueprint, abilities: [{ ...ability, type: 'activated', cost: { tap: true, discard: 1 } }] };
    engine.roomState.battlefield.push(land);
    const discard = instantiateCard('land-red'); discard.state = { ...discard.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    engine.roomState.players.player1.hand = [card, discard];
    expect(new OptionService().getOptions(engine.roomState, 'player1', land.uuid, 'battlefield')[0].disabled).toBe(false);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, manaActivations: [{ cardUuid: land.uuid, abilityId: ability.id }] }).success).toBe(true);
    expect(engine.roomState.pendingChoice?.kind).toBe('discard');
    expect(engine.roomState.pendingChoice!.options.map(option => option.id)).toEqual([discard.uuid]);
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(false);
    expect(answer(engine, [discard.uuid]).success).toBe(true);
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(true); expect(engine.roomState.players.player1.mana.red).toBe(0); engine.dispose();
  });
  it('refreshes a queued trigger source when it departs before stack insertion', () => {
    const all = { type: 'permanent' as const, all: true, required: false };
    const { engine, card } = fixture([
      { action: 'MOVE_ZONE', params: { destination: 'battlefield' }, targeting: { type: 'self', required: false }, choice: { kind: 'search', zone: 'library', min: 1, max: 1 } },
      { ...gain(0), choice: { kind: 'optional' } },
      { action: 'ADD_COUNTER', params: { counterType: '+1/+1', amount: 2 }, targeting: all },
      { action: 'MOVE_ZONE', params: { origin: 'battlefield', destination: 'graveyard' }, targeting: all },
      { ...gain(0), choice: { kind: 'optional' } },
    ]);
    const child = instantiateCard('empire-servant'); child.state.ownerId = child.state.controllerId = 'player1';
    child.blueprint = { ...child.blueprint, power: 5, toughness: 5, abilities: [], onEnterEffects: [{ ...gain(0), params: { amount: 'DYNAMIC:source.power' } }] };
    engine.roomState.players.player1.deck = [child];
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); engine.resolveTopOfStack();
    answer(engine, [child.uuid]); answer(engine, ['yes']);
    const queued = engine.roomState.pendingTriggers!.find(mutation => mutation.type === 'PUSH_STACK');
    expect(queued?.type === 'PUSH_STACK' && queued.stackObject.sourceInfo?.power).toBe(7);
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); restored.initRoom(); engine.dispose();
    answer(restored, ['yes']); restored.resolveTopOfStack();
    expect(restored.roomState.players.player1.life).toBe(27); restored.dispose();
  });
});
