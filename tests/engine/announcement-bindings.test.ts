import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { GameEngine } from '@engine/game-engine';
import { normalizeCard, normalizeAbility } from '@library/card-parser';
import { gameReducer } from '@engine/game-reducer';
import { createTargetingState } from '@client/targeting';
import { OptionService } from '@engine/option-service';
import { CardCharacteristicService } from '@engine/card-characteristic-service';
import { instantiateCard } from '@library/card-factory';

const x = { numeric: { kind: 'binding', name: 'X' } } as const;
const gain = { action: 'MODIFY_LIFE', params: { amount: x }, targeting: { type: 'self', required: false } } as const;
const raw = (extra = {}) => ({ id: 'numeric-fixture', name: 'Numeric fixture', cardTypes: ['Spell'],
  numericDeclarations: [{ name: 'X', min: 0, max: 6 }], manaCost: '{X}', onCastEffects: [gain], abilities: [], ...extra });
function fixture(extra = {}) {
  const room = createTestRoom(); const card = room.players.player1.hand[0];
  // In-memory fixtures exercise the action flow separately from loader validation.
  card.blueprint = { ...card.blueprint, ...raw(extra), castRequirements: { allowedZones: ['hand'], speed: 'instant', cost: { mana: { generic: x } } } } as any;
  const engine = new GameEngine(room); engine.initRoom();
  return { engine, card };
}
const choose = (engine: GameEngine, number: unknown) => engine.executePlayerAction('player1', 'choose', { choiceId: engine.roomState.pendingChoice?.id, number });

describe('minimal announcement bindings', () => {
  it('selects modes then independent declarations in authored order', () => {
    const y = { numeric: { kind: 'binding', name: 'Y' } };
    const effect = { ...gain, params: { amount: { numeric: { kind: 'multiply', left: x, right: y } } } };
    const { engine, card } = fixture({ numericDeclarations: [{ name: 'X', min: 0 }, { name: 'Y', min: 0 }],
      onCastEffects: [], modes: [{ id: 'product', label: 'Product', effects: [effect] }] });
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid });
    expect(engine.roomState.pendingChoice?.kind).toBe('modes');
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: engine.roomState.pendingChoice?.id, choices: ['product'] }).success).toBe(true);
    expect(engine.roomState.pendingChoice?.prompt).toBe('Choose X');
    expect(choose(engine, 3).success).toBe(true); expect(engine.roomState.pendingChoice?.prompt).toBe('Choose Y');
    expect(choose(engine, 4).success).toBe(true); engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(32); engine.dispose();
  });
  it('keeps bindings through explicit payment and cancellation discards an unpaid draft', () => {
    const { engine, card } = fixture(); const before = structuredClone(engine.roomState.players.player1.mana);
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, choosePayment: true });
    expect(choose(engine, 2).success).toBe(true); expect(engine.roomState.pendingChoice?.kind).toBe('payment');
    expect(engine.roomState.players.player1.mana).toEqual(before);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: engine.roomState.pendingChoice?.id, cancel: true }).success).toBe(true);
    expect(engine.roomState.players.player1.mana).toEqual(before); expect(engine.roomState.stack).toEqual([]);
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, choosePayment: true, numericBindings: { X: 1 } });
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: engine.roomState.pendingChoice?.id, allocations: { red: 1 } }).success).toBe(true);
    expect(engine.roomState.stack[0]).toMatchObject({ numericBindings: { X: 1 } }); engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(21); engine.dispose();
  });
  it('preserves bindings through a nested mana discard prompt without paying early', () => {
    const { engine, card } = fixture();
    const supply = instantiateCard('land-red'); const discarded = instantiateCard('empire-servant');
    supply.blueprint = { ...supply.blueprint, abilities: [normalizeAbility({ id: 'supply', type: 'activated', cost: { tap: true, discard: 1 },
      effectId: 'ADD_MANA', params: { color: 'red', amount: 2 } })!] };
    supply.state = { ...supply.state, ownerId: 'player1', controllerId: 'player1', zone: 'battlefield' };
    discarded.state = { ...discarded.state, ownerId: 'player1', controllerId: 'player1', zone: 'hand' };
    engine.roomState.battlefield = [supply]; engine.roomState.players.player1.hand.push(discarded);
    for (const color of Object.keys(engine.roomState.players.player1.mana)) (engine.roomState.players.player1.mana as any)[color] = 0;
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, manaActivations: [{ cardUuid: supply.uuid, abilityId: 'supply' }] }).success).toBe(true);
    expect(choose(engine, 2).success).toBe(true); expect(engine.roomState.pendingChoice?.kind).toBe('discard');
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(false); expect(engine.roomState.stack).toEqual([]);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: engine.roomState.pendingChoice?.id, choices: [discarded.uuid] }).success).toBe(true);
    expect(engine.roomState.stack[0]).toMatchObject({ numericBindings: { X: 2 } });
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(true); expect(engine.roomState.players.player1.mana.red).toBe(0);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toContain(discarded.uuid);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.life).toBe(22); engine.dispose();
  });
  it('clears copied spell declarations and gives granted abilities their own declaration scope', () => {
    const { engine, card } = fixture();
    const copy = normalizeCard({ id: 'fixed-fixture', name: 'Fixed', cardTypes: ['Spell'], manaCost: '{1}', onCastEffects: [{ ...gain, params: { amount: 1 } }], abilities: [] });
    const changed = gameReducer(engine.roomState, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, layer: 1, duration: 'PERMANENT',
      scope: { cardUuid: card.uuid, zones: ['hand'] }, effect: { type: 'COPY', blueprint: copy } } });
    expect(CardCharacteristicService.resolveBlueprint(changed, card).numericDeclarations).toEqual([]);
    const ability = normalizeAbility({ id: 'own', type: 'activated', numericDeclarations: [{ name: 'Y', min: 0 }],
      cost: {}, effectId: 'MODIFY_LIFE', params: { amount: { numeric: { kind: 'binding', name: 'Y' } } } });
    const granted = gameReducer(changed, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, layer: 6, duration: 'PERMANENT',
      scope: { cardUuid: card.uuid, zones: ['hand'] }, effect: { type: 'ABILITY', add: [ability!] } } });
    expect(CardCharacteristicService.resolveAbilities(granted, card).find(a => a.type === 'activated')?.numericDeclarations).toEqual([{ name: 'Y', min: 0 }]); engine.dispose();
  });
  it.each([
    { numericDeclarations: [{ name: 'X', min: 3, max: 2 }] },
    { numericDeclarations: [{ name: 'X', min: 0 }, { name: 'X', min: 0 }] },
    { numericDeclarations: [{ name: '__proto__', min: 0 }] },
    { numericDeclarations: [{ name: 'X', min: 0.5 }] },
    { numericDeclarations: [{ name: 'X', min: 0, unexpected: 1 }] },
    { abilities: [{ id: 'mana', type: 'activated', numericDeclarations: [{ name: 'X', min: 0 }], effectId: 'ADD_MANA', params: { amount: x, color: 'red' } }] },
    { abilities: [{ id: 'trigger', type: 'triggered', numericDeclarations: [{ name: 'X', min: 0 }], effectId: 'MODIFY_LIFE', params: { amount: x } }] },
  ])('rejects invalid declarations and unsupported owners %j', extra => {
    expect(() => normalizeCard(raw(extra))).toThrow();
  });
  it('parses repeated X through shared arithmetic and rejects unowned references', () => {
    const definition = normalizeCard(raw({ manaCost: '{2}{X}{X}{R}' }));
    expect((definition as any).numericDeclarations).toEqual([{ name: 'X', min: 0, max: 6 }]);
    const { engine, card } = fixture(); card.blueprint = definition;
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, numericBindings: { X: 2 } }).success).toBe(true);
    expect(Object.values(engine.roomState.players.player1.mana).reduce((a, b) => a + b, 0)).toBe(23);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.life).toBe(22); engine.dispose();
    expect(() => normalizeCard(raw({ numericDeclarations: [] }))).toThrow();
    expect(() => normalizeCard(raw({ onEnterEffects: [gain] }))).toThrow();
    expect(() => normalizeCard(raw({ abilities: [{ id: 'unowned', type: 'activated', effectId: 'MODIFY_LIFE', params: { amount: x } }] }))).toThrow();
  });
  it('prompts before costs, retains zero, and restores the scalar request through JSON', () => {
    const { engine, card } = fixture(); const mana = structuredClone(engine.roomState.players.player1.mana);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
    expect(engine.roomState.pendingChoice).toMatchObject({ kind: 'number', range: { min: 0, max: 6 } });
    expect(engine.roomState.pendingChoice).not.toHaveProperty('options');
    expect(engine.roomState.players.player1.mana).toEqual(mana);
    const recovered = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); engine.dispose(); recovered.initRoom();
    expect(choose(recovered, 0).success).toBe(true);
    expect(recovered.roomState.stack[0]).toMatchObject({ numericBindings: { X: 0 } });
    expect(recovered.roomState.players.player1.mana).toEqual(mana);
    recovered.resolveTopOfStack(); expect(recovered.roomState.players.player1.life).toBe(20); recovered.dispose();
  });
  it.each(['', '2', null, -1, 7, 1.5, NaN, Infinity])('rejects invalid scalar %s without spending or closing the request', value => {
    const { engine, card } = fixture(); engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid });
    const before = structuredClone(engine.roomState);
    expect(choose(engine, value).success).toBe(false); expect(engine.roomState).toEqual(before); engine.dispose();
  });
  it('fixes numbers across target/payment prompts and rejects a returned source incarnation', () => {
    const { engine, card } = fixture({ onCastEffects: [{ ...gain, targeting: { type: 'player', required: true } }] });
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid });
    expect(choose(engine, 3).success).toBe(true); expect(engine.roomState.pendingChoice?.kind).toBe('targets');
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'exile' },
      { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'exile', to: 'hand' }]);
    const choice = engine.roomState.pendingChoice!; const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: [(choice as any).options[0].id] }).success).toBe(false);
    expect(engine.roomState).toEqual(before);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, cancel: true }).success).toBe(true); engine.dispose();
  });
  it('rejects a changed effective announcement without paying', () => {
    const { engine, card } = fixture(); engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid });
    card.blueprint = {
      ...card.blueprint,
      castRequirements: { ...card.blueprint.castRequirements, cost: { mana: { generic: 5 } } },
    };
    const before = structuredClone(engine.roomState);
    expect(choose(engine, 2).success).toBe(false); expect(engine.roomState).toEqual(before); engine.dispose();
  });
  it('keeps numeric identifiers stable through text changes', () => {
    const { engine, card } = fixture();
    engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, layer: 3, duration: 'PERMANENT',
      scope: { cardUuid: card.uuid, zones: ['hand'] }, effect: { type: 'TEXT', replacements: { X: 'red' } } } }]);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, numericBindings: { X: 2 } }).success).toBe(true);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.life).toBe(22); engine.dispose();
  });
  it('combines fixed bindings with live queries after earlier instructions', () => {
    const query = { numeric: { kind: 'query', id: 'field', args: { path: 'controller.life' } } };
    const { engine, card } = fixture({ onCastEffects: [{ ...gain, params: { amount: 1 } },
      { ...gain, params: { amount: { numeric: { kind: 'add', left: x, right: query } } } }] });
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, numericBindings: { X: 3 } }).success).toBe(true);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.life).toBe(45); engine.dispose();
  });
  it('retains bindings through a paused resolution branch after serialization', () => {
    const { engine, card } = fixture({ onCastEffects: [{ ...gain, choice: { kind: 'options', options: [{ id: 'gain', label: 'Gain', effects: [gain] }] } }] });
    const supplied = { X: 3 };
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, numericBindings: supplied }).success).toBe(true);
    supplied.X = 6; engine.resolveTopOfStack();
    expect(engine.roomState.pendingChoice?.kind).toBe('options');
    const recovered = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); engine.dispose(); recovered.initRoom();
    expect(recovered.executePlayerAction('player1', 'choose', { choiceId: recovered.roomState.pendingChoice?.id, choices: ['gain'] }).success).toBe(true);
    expect(recovered.roomState.players.player1.life).toBe(23); recovered.dispose();
  });
  it('allows activation-owned bindings after the source is sacrificed', () => {
    const { engine, card } = fixture();
    const ability = normalizeAbility({ id: 'numeric', type: 'activated', numericDeclarations: [{ name: 'X', min: 0 }],
      cost: { mana: { generic: x }, sacrifice: true }, effectId: 'MODIFY_LIFE', params: { amount: x } });
    card.blueprint = { ...card.blueprint, numericDeclarations: [], abilities: [ability!] } as any;
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'battlefield' }]);
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: card.uuid, abilityId: 'numeric', numericBindings: { X: 2 } }).success).toBe(true);
    expect(engine.roomState.battlefield).toEqual([]); engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(22); engine.dispose();
  });
  it('rejects invalid supplied records and unaffordable bindings atomically', () => {
    for (const numericBindings of [null, [], { X: 100 }, { X: 1.5 }, { Y: 2 }, { X: '3' }, { X: 3, other: 1 }]) {
      const { engine, card } = fixture(); const before = structuredClone(engine.roomState);
      expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, numericBindings }).success).toBe(false);
      expect(engine.roomState).toEqual(before); engine.dispose();
    }
    const { engine, card } = fixture(); for (const color of Object.keys(engine.roomState.players.player1.mana)) (engine.roomState.players.player1.mana as any)[color] = 0;
    const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, numericBindings: { X: 2 } }).success).toBe(false);
    expect(engine.roomState).toEqual(before); engine.dispose();
  });
  it('routes declared actions to server choices and avoids unresolved option affordability', () => {
    const { engine, card } = fixture({ onCastEffects: [{ ...gain, targeting: { type: 'player', required: true } }] });
    expect(createTargetingState(card, 'hand', 'cast_spell', undefined, engine.roomState)).toBeNull();
    expect(new OptionService().getOptions(engine.roomState, 'player1', card.uuid, 'hand')[0].disabled).toBe(false); engine.dispose();
  });
});
