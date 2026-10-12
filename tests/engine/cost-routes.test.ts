import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { activateAbilityHandler } from '../../src/engine/handlers/activate-ability-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { normalizeCard, normalizeAbility } from '../../src/library/card-parser';
import { prepareAnnouncement, spellAnnouncementDefinition } from '../../src/engine/announcement-values';
import { gameReducer } from '../../src/engine/game-reducer';
import { createTargetingState } from '../../src/client/targeting';
import { OptionService } from '../../src/engine/option-service';

const gain = { action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } };
const alternatives = [{ id: 'life', label: 'Pay two life', cost: { life: 2 } }];
function fixture(requirements = {}, extra = {}) {
  const room = createTestRoom(); const card = room.players.player1.hand[0];
  card.blueprint = { ...card.blueprint, cardTypes: ['Spell'], abilities: [], onCastEffects: [gain], ...extra,
    castRequirements: { allowedZones: ['hand'], speed: 'instant', cost: { mana: { generic: 3 } },
      alternativeCosts: alternatives, additionalCost: { discard: 1 }, ...requirements } } as any;
  const discard = instantiateCard('empire-servant');
  discard.state = { ...discard.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
  room.players.player1.hand.push(discard);
  registerAction('cast_spell', playCardHandler); registerAction('activate_ability', activateAbilityHandler);
  const engine = new GameEngine(room); engine.initRoom(); return { engine, card, discard };
}
function answer(engine: GameEngine, kind: 'base' | 'alternative') {
  const choice = engine.roomState.pendingChoice;
  if (!choice || choice.kind === 'number') throw new Error('Expected listed route choice');
  const selected = choice.options.find(option => (option.value as any).kind === kind)!;
  return engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: [selected?.id] });
}
const discardAnswer = (engine: GameEngine, uuid: string) => engine.executePlayerAction('player1', 'choose', { choiceId: engine.roomState.pendingChoice?.id, choices: [uuid] });

describe('payment cost routes', () => {
  it.each(['base', 'alternative'] as const)('chooses %s then mandatory discard and pays once', kind => {
    const { engine, card, discard } = fixture(); const before = structuredClone(engine.roomState.players.player1.mana);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
    expect(engine.roomState.pendingChoice?.kind).toBe('options');
    expect(engine.roomState.players.player1.mana).toEqual(before);
    expect(answer(engine, kind).success).toBe(true); expect(engine.roomState.pendingChoice?.kind).toBe('discard');
    expect(engine.roomState.players.player1.life).toBe(20);
    expect(discardAnswer(engine, discard.uuid).success).toBe(true);
    expect(engine.roomState.players.player1.life).toBe(kind === 'base' ? 20 : 18);
    expect(Object.values(engine.roomState.players.player1.mana).reduce((a, b) => a + b, 0)).toBe(kind === 'base' ? 27 : 30);
    expect(engine.roomState.stack).toHaveLength(1);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.life).toBe(kind === 'base' ? 21 : 19); engine.dispose();
  });
  it('composes mandatory mana and life with the selected complete replacement', () => {
    const { engine, card } = fixture({ additionalCost: { mana: { generic: 1, red: 1 }, life: 1 },
      alternativeCosts: [{ id: 'other', label: 'Other', cost: { mana: { generic: 2, red: 1 }, life: 2 } }] });
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, costRoute: { kind: 'alternative', id: 'other' }, payment: { red: 2, blue: 3 } }).success).toBe(true);
    expect(engine.roomState.players.player1.life).toBe(17); expect(engine.roomState.players.player1.mana).toMatchObject({ red: 3, blue: 2 }); engine.dispose();
  });
  it('applies mandatory extras without requiring an alternative prompt', () => {
    const { engine, card } = fixture({ alternativeCosts: undefined, additionalCost: { life: 2 } });
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
    expect(engine.roomState.pendingChoice).toBeUndefined(); expect(engine.roomState.players.player1.life).toBe(18); engine.dispose();
  });
  it.each([null, [], 'life', {}, { kind: 'unknown' }, { kind: 'alternative', id: 'missing' }, { kind: 'base', cost: {} }])('rejects malformed or unknown route %j atomically', costRoute => {
    const { engine, card, discard } = fixture(); const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, costRoute, discardUuids: [discard.uuid] }).success).toBe(false);
    expect(engine.roomState).toEqual(before); engine.dispose();
  });
  it('rejects incomplete direct handler execution instead of using the base cost', () => {
    const { engine, card, discard } = fixture();
    expect(playCardHandler.validate(engine.roomState, 'player1', { cardUuid: card.uuid, discardUuids: [discard.uuid] }).success).toBe(false);
    expect(playCardHandler.propose(engine.roomState, 'player1', { cardUuid: card.uuid, discardUuids: [discard.uuid] }).success).toBe(false); engine.dispose();
  });
  it('normalizes authored routes and their declared generic expressions', () => {
    const x = { numeric: { kind: 'binding', name: 'X' } };
    const blueprint = normalizeCard({ id: 'payment-fixture', numericDeclarations: [{ name: 'X', min: 0 }], manaCost: '{3}',
      castRequirements: { speed: 'instant', alternativeCosts: [{ id: 'variable', label: 'Variable', cost: { mana: { generic: x } } }], additionalCost: { mana: { red: 1 } } } });
    expect((blueprint.castRequirements as any).alternativeCosts?.[0].cost.mana.generic).toEqual(x);
    const { engine, card } = fixture(); card.blueprint = blueprint;
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, numericBindings: { X: 2 }, costRoute: { kind: 'alternative', id: 'variable' }, payment: { red: 1, blue: 2 } }).success).toBe(true);
    expect(engine.roomState.players.player1.mana).toMatchObject({ red: 4, blue: 3 }); engine.dispose();
  });
  it('chooses zero before the route and retains it through combined mana payment', () => {
    const x = { numeric: { kind: 'binding', name: 'X' } };
    const { engine, card } = fixture({ alternativeCosts: [{ id: 'variable', label: 'Pay chosen number', cost: { mana: { generic: x } } }],
      additionalCost: { mana: { red: 1 } } }, { numericDeclarations: [{ name: 'X', min: 0, max: 5 }] });
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, choosePayment: true });
    expect(engine.roomState.pendingChoice?.kind).toBe('number');
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: engine.roomState.pendingChoice?.id, number: 0 }).success).toBe(true);
    expect(engine.roomState.pendingChoice?.kind).toBe('options'); expect(answer(engine, 'alternative').success).toBe(true);
    expect(engine.roomState.pendingChoice?.kind).toBe('payment'); expect(engine.roomState.players.player1.mana.red).toBe(5);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: engine.roomState.pendingChoice?.id, allocations: { red: 1 } }).success).toBe(true);
    expect(engine.roomState.players.player1.mana.red).toBe(4); expect(engine.roomState.stack[0]).toMatchObject({ numericBindings: { X: 0 } }); engine.dispose();
  });
  it.each([
    { alternativeCosts: [{ id: 'a', label: 'A', cost: { bogus: 1 } }] },
    { alternativeCosts: [{ id: 'a', label: 'A', cost: { life: -1 } }] },
    { alternativeCosts: [{ id: 'a', label: 'A', cost: { mana: { purple: 1 } } }] },
    { alternativeCosts: [{ id: 'a', label: 'A', cost: { tap: 'yes' } }] },
    { alternativeCosts: [{ id: 'a', label: 'A', cost: {} }, { id: 'a', label: 'Again', cost: {} }] },
    { additionalCost: { loyalty: -1 } },
    { additionalCost: { mana: { generic: { numeric: { kind: 'binding', name: 'unowned' } } } } },
  ])('rejects unsupported authored cost routes %j before normalization', requirements => {
    expect(() => normalizeCard({ id: 'invalid-payment-fixture', castRequirements: requirements })).toThrow();
  });
  it('rejects payment routes on mana and triggered abilities', () => {
    expect(() => normalizeAbility({ id: 'mana', type: 'activated', effectId: 'ADD_MANA', params: { color: 'red', amount: 1 }, alternativeCosts: alternatives })).toThrow();
    expect(() => normalizeAbility({ id: 'trigger', type: 'triggered', effectId: 'MODIFY_LIFE', additionalCost: { life: 1 } })).toThrow();
  });
  it('does not disable an unresolved alternative based on base affordability', () => {
    const { engine, card } = fixture({ cost: { mana: { generic: 99 } } }, { onCastEffects: [{ ...gain, targeting: { type: 'player', required: true } }] });
    expect(new OptionService().getOptions(engine.roomState, 'player1', card.uuid, 'hand')[0].disabled).toBe(false);
    expect(createTargetingState(card, 'hand', 'cast_spell', {}, engine.roomState)).toBeNull(); engine.dispose();
  });
  it.each([
    [{ mana: { generic: 99 } }, { life: 2 }],
    [{ mana: { generic: 1 } }, { life: 21 }],
  ])('checks the known combined cost in spell and ability options: %j plus %j', (cost, additionalCost) => {
    const { engine, card, discard } = fixture({ cost, additionalCost, alternativeCosts: undefined });
    const options = new OptionService();
    expect(options.getOptions(engine.roomState, 'player1', card.uuid, 'hand')[0].disabled).toBe(true);
    card.state = { ...card.state, zone: 'battlefield', summoningSickness: false };
    card.blueprint = { ...card.blueprint, abilities: [normalizeAbility({ id: 'known', type: 'activated', cost, additionalCost,
      effectId: 'MODIFY_LIFE', params: { amount: 1 } })!] };
    engine.roomState.battlefield = [card]; engine.roomState.players.player1.hand = [discard];
    expect(options.getOptions(engine.roomState, 'player1', card.uuid, 'battlefield').find(o => o.data?.abilityId === 'known')?.disabled).toBe(true); engine.dispose();
  });
  it('keeps the route through JSON recovery, and cancellation restores an unpaid action', () => {
    const { engine, card } = fixture(); engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid });
    expect(answer(engine, 'alternative').success).toBe(true);
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); engine.dispose(); restored.initRoom();
    expect(restored.roomState.pendingChoice?.continuation).toMatchObject({ data: { costRoute: { kind: 'alternative', id: 'life' } } });
    expect(restored.executePlayerAction('player1', 'choose', { choiceId: restored.roomState.pendingChoice?.id, cancel: true }).success).toBe(true);
    expect(restored.roomState.players.player1.life).toBe(20); expect(restored.roomState.stack).toEqual([]); restored.dispose();
  });
  it('rejects changed payment definitions before a later discard answer', () => {
    const { engine, card, discard } = fixture(); engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); answer(engine, 'alternative');
    const live = engine.roomState.players.player1.hand.find(c => c.uuid === card.uuid)!;
    live.blueprint = { ...live.blueprint, castRequirements: { ...live.blueprint.castRequirements, additionalCost: { discard: 2 } } } as any;
    const before = structuredClone(engine.roomState); expect(discardAnswer(engine, discard.uuid).success).toBe(false);
    expect(engine.roomState).toEqual(before); engine.dispose();
  });
  it('rejects a source that departed and returned while its payment prompt was open', () => {
    const { engine, card, discard } = fixture(); engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }); answer(engine, 'alternative');
    Object.assign(engine.roomState, gameReducer(engine.roomState, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'exile' }));
    Object.assign(engine.roomState, gameReducer(engine.roomState, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'exile', to: 'hand' }));
    const before = structuredClone(engine.roomState); expect(discardAnswer(engine, discard.uuid).success).toBe(false);
    expect(engine.roomState).toEqual(before); engine.dispose();
  });
  it.each([
    [{ life: Number.MAX_SAFE_INTEGER }, { life: 1 }],
    [{ mana: { generic: Number.MAX_SAFE_INTEGER } }, { mana: { generic: 1 } }],
    [{ tap: true }, { tap: true }], [{ tap: true }, { untap: true }], [{ sacrifice: true }, { sacrifice: true }],
  ])('rejects impossible composition %j plus %j', (cost, additionalCost) => {
    const { engine, card } = fixture({ cost, additionalCost, alternativeCosts: undefined });
    expect(prepareAnnouncement(card, spellAnnouncementDefinition(card.blueprint), {}).success).toBe(false); engine.dispose();
  });
  it('uses the same route composition for ordinary activated abilities', () => {
    const { engine, card, discard } = fixture();
    card.state = { ...card.state, zone: 'battlefield', summoningSickness: false };
    card.blueprint = { ...card.blueprint, abilities: [normalizeAbility({ id: 'pay', type: 'activated', cost: { mana: { generic: 99 } },
      alternativeCosts: alternatives, additionalCost: { tap: true, discard: 1 }, effectId: 'MODIFY_LIFE', params: { amount: 1 } })!] };
    engine.roomState.players.player1.hand = [discard]; engine.roomState.battlefield = [card];
    expect(new OptionService().getOptions(engine.roomState, 'player1', card.uuid, 'battlefield').find(o => o.data?.abilityId === 'pay')?.disabled).toBe(false);
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: card.uuid, abilityId: 'pay' }).success).toBe(true);
    expect(answer(engine, 'alternative').success).toBe(true); expect(discardAnswer(engine, discard.uuid).success).toBe(true);
    expect(engine.roomState.players.player1.life).toBe(18); expect(engine.roomState.battlefield[0].state.isTapped).toBe(true);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.life).toBe(19); engine.dispose();
  });
  it('preserves the selected route through nested mana prompts and reserves the cast source', () => {
    const { engine, card, discard } = fixture({ alternativeCosts: [{ id: 'red', label: 'Pay red', cost: { mana: { red: 2 } } }] });
    const supply = instantiateCard('land-red');
    supply.state = { ...supply.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
    supply.blueprint = { ...supply.blueprint, abilities: [normalizeAbility({ id: 'supply', type: 'activated', cost: { tap: true, discard: 1 },
      effectId: 'ADD_MANA', params: { color: 'red', amount: 2 } })!] };
    const extra = instantiateCard('empire-servant'); extra.state = { ...extra.state, ownerId: 'player1', controllerId: 'player1', zone: 'hand' };
    engine.roomState.players.player1.hand.push(extra); engine.roomState.battlefield = [supply];
    for (const color of Object.keys(engine.roomState.players.player1.mana)) (engine.roomState.players.player1.mana as any)[color] = 0;
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, manaActivations: [{ cardUuid: supply.uuid, abilityId: 'supply' }] });
    expect(answer(engine, 'alternative').success).toBe(true);
    const nested = engine.roomState.pendingChoice!; expect(nested.kind).toBe('discard');
    expect(nested.kind !== 'number' && nested.options.some(option => option.id === card.uuid)).toBe(false);
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(false);
    expect(discardAnswer(engine, discard.uuid).success).toBe(true);
    expect(engine.roomState.pendingChoice?.kind).toBe('discard'); expect(engine.roomState.battlefield[0].state.isTapped).toBe(false);
    const unpaid = structuredClone(engine.roomState);
    expect(discardAnswer(engine, discard.uuid).success).toBe(false); expect(engine.roomState).toEqual(unpaid);
    expect(discardAnswer(engine, extra.uuid).success).toBe(true); expect(engine.roomState.battlefield[0].state.isTapped).toBe(true);
    expect(engine.roomState.players.player1.mana.red).toBe(0); expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toEqual(expect.arrayContaining([discard.uuid, extra.uuid])); engine.dispose();
  });
  it('leaves all resources unchanged when the selected route cannot be paid', () => {
    const { engine, card, discard } = fixture({ alternativeCosts: [{ id: 'life', label: 'Too much life', cost: { life: 21 } }] });
    const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, costRoute: { kind: 'alternative', id: 'life' }, discardUuids: [discard.uuid] }).success).toBe(false);
    expect(engine.roomState).toEqual(before); engine.dispose();
  });
});
