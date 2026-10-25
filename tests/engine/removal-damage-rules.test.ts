import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature, combatRoom } from '../helpers/combat-fixture';
import { GameEngine } from '@engine/game-engine';
import { captureSourceInformation } from '@engine/source-information';
import { planDamage } from '@engine/damage-service';
import { EffectRegistry } from '@engine/effect-registry';
import type { GameMutation } from '@shared/game-mutation.types';
import type { GameRoom } from '@shared/game.room.types';
import type { ReplacementDefinition } from '@shared/proposed-event.types';

const destroy = (uuid: string): GameMutation => ({ type: 'DESTROY_CARD', cardUuid: uuid, zoneRevision: 0 });
const sacrifice = (uuid: string): GameMutation => ({ type: 'SACRIFICE_CARD', cardUuid: uuid, zoneRevision: 0 });
const shield = (uuid: string): ReplacementDefinition => ({ id: 'regenerate', label: 'Regenerate', match: { kinds: ['destroy'], card: { cardUuid: uuid, zoneRevision: 0 } }, operation: { type: 'regenerate' }, uses: 1, duration: 'end_of_turn' });
function deal(room: GameRoom, amount: number, recipient = { kind: 'player' as const, playerId: 'player2' }) {
  return planDamage(room, [{ source: captureSourceInformation(room, room.battlefield[0]), recipient, amount, combat: false }]);
}

describe('semantic removal and generic damage consumers', () => {
  it('allows a self-replacement to replace prohibited destruction before other replacements', () => {
    const card = creature('a', 'player1', 2, 4, ['Indestructible']);
    const engine = new GameEngine(createTestRoom({ battlefield: [card], replacementEffects: [shield('a'),
      { id: 'self', label: 'Exile instead', selfReplacement: true, match: { kinds: ['destroy'] }, operation: { type: 'move_destination', to: 'exile' } }] }));
    engine.applyMutations([destroy('a')]);
    expect(engine.roomState.battlefield).toEqual([]);
    expect(engine.roomState.players.player1.exile?.map(c => c.uuid)).toEqual(['a']);
    expect(engine.roomState.replacementEffects?.find(rule => rule.id === 'regenerate')?.uses).toBe(1);
    engine.dispose();
  });
  it('blocks destruction with effective indestructible without consuming regeneration', () => {
    const card = creature('a', 'player1', 2, 4, ['Indestructible']);
    const room = createTestRoom({ battlefield: [card], replacementEffects: [shield('a')] });
    const engine = new GameEngine(room);
    engine.applyMutations([destroy('a')]);
    expect(engine.roomState.battlefield.map(c => c.uuid)).toEqual(['a']);
    expect(engine.roomState.replacementEffects?.[0].uses).toBe(1);
    engine.applyMutations([sacrifice('a')]);
    expect(engine.roomState.battlefield).toEqual([]);
    expect(engine.roomState.players.player1.graveyard[0].uuid).toBe('a');
    engine.dispose();
  });

  it('regeneration taps, clears damage and removes the permanent from combat once', () => {
    const card = creature('a', 'player1'); card.state.damageTaken = 3;
    const room = combatRoom(createTestRoom({ replacementEffects: [shield('a')] }), card);
    const engine = new GameEngine(room);
    engine.applyMutations([destroy('a')]);
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(true);
    expect(engine.roomState.battlefield[0].state.damageTaken).toBe(0);
    expect(engine.roomState.combat).toEqual([]);
    expect(engine.roomState.replacementEffects).toEqual([]);
    engine.applyMutations([destroy('a')]);
    expect(engine.roomState.battlefield).toEqual([]);
    engine.dispose();
  });

  it('ignores stale destruction incarnations', () => {
    const card = creature('a', 'player1'); card.state.zoneRevision = 2;
    const engine = new GameEngine(createTestRoom({ battlefield: [card] }));
    engine.applyMutations([destroy('a')]);
    expect(engine.roomState.battlefield).toHaveLength(1);
    engine.dispose();
  });

  it('routes generic destroy and sacrifice effect definitions through semantic operations', () => {
    const card = creature('a', 'player1');
    const room = createTestRoom({ battlefield: [card] });
    const stack = { type: 'activated' as const, uuid: 's', source: card, controllerId: 'player1', effects: [], countered: false };
    const effect = { action: 'DESTROY', params: {}, tags: [], targeting: { type: 'self' as const }, targets: [{ targetType: 'permanent' as const, cardUuid: 'a' }] };
    expect(EffectRegistry.DESTROY(room, stack, effect)).toEqual([destroy('a')]);
    expect(EffectRegistry.SACRIFICE(room, stack, effect)).toEqual([sacrifice('a')]);
  });

  it('lifelink uses actual damage after prevention and happens before player losses', () => {
    const card = creature('a', 'player1', 2, 4, ['Lifelink']);
    const room = createTestRoom({ battlefield: [card], replacementEffects: [{ id: 'prevent', label: 'Prevent two', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage', amount: 2 } }] });
    room.players.player1.life = 1;
    const engine = new GameEngine(room);
    const mutations = deal(room, 5);
    const assignment = (mutations[0] as Extract<GameMutation, { type: 'APPLY_DAMAGE_BATCH' }>).assignments[0];
    engine.applyMutations([{ type: 'APPLY_DAMAGE_BATCH', assignments: [assignment, { ...assignment, source: captureSourceInformation(room, creature('other', 'player2')), recipient: { kind: 'player', playerId: 'player1' }, amount: 3 }] }]);
    expect(engine.roomState.players.player1.life).toBe(3);
    expect(engine.roomState.players.player2.life).toBe(17);
    expect(engine.roomState.status).toBe('playing');
    engine.dispose();
  });

  it('infect poisons players and wither puts counters on creatures instead of marked damage', () => {
    const source = creature('source', 'player1', 2, 4, ['Infect']);
    const victim = creature('victim', 'player2', 2, 10);
    const room = createTestRoom({ battlefield: [source, victim] });
    const engine = new GameEngine(room);
    engine.applyMutations(deal(room, 3));
    expect(engine.roomState.players.player2.life).toBe(20);
    expect(engine.roomState.players.player2.poison).toBe(3);
    engine.applyMutations(planDamage(engine.roomState, [{ source: captureSourceInformation(engine.roomState, source), recipient: { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }, amount: 2, combat: false }]));
    expect(engine.roomState.battlefield[1].state.damageTaken).toBe(0);
    expect(engine.roomState.battlefield[1].state.counters['-1/-1']).toBe(2);
    engine.dispose();
  });

  it('records actual deathtouch damage and leaves a fully prevented recipient alive', () => {
    const source = creature('source', 'player1', 2, 4, ['Deathtouch']);
    const victim = creature('victim', 'player2', 2, 10);
    const room = createTestRoom({ battlefield: [source, victim] });
    const engine = new GameEngine(room);
    engine.applyMutations(planDamage(room, [{ source: captureSourceInformation(room, source), recipient: { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }, amount: 1, combat: true }]));
    expect(engine.roomState.battlefield.map(c => c.uuid)).toEqual(['source']);
    engine.dispose();
    const protectedRoom = { ...room, replacementEffects: [{ id: 'prevent', label: 'Prevent all', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage' as const } }] };
    const protectedEngine = new GameEngine(protectedRoom);
    protectedEngine.applyMutations(planDamage(protectedRoom, [{ source: captureSourceInformation(protectedRoom, source), recipient: { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }, amount: 1, combat: true }]));
    expect(protectedEngine.roomState.battlefield).toHaveLength(2);
    expect(protectedEngine.roomState.battlefield[1].state.deathtouchDamage).toBeUndefined();
    protectedEngine.dispose();
  });

  it('protection prevents matching damage while shroud alone does not', () => {
    const source = creature('source', 'player1');
    const victim = creature('victim', 'player2', 2, 10, ['Protection from creatures', 'Shroud']);
    const room = createTestRoom({ battlefield: [source, victim] });
    const engine = new GameEngine(room);
    engine.applyMutations(planDamage(room, [{ source: captureSourceInformation(room, source), recipient: { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }, amount: 2, combat: false }]));
    expect(engine.roomState.battlefield[1].state.damageTaken).toBe(0);
    engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'source', layer: 6, scope: { cardUuid: 'victim' }, duration: 'PERMANENT', effect: { type: 'ABILITY', removeKeywords: ['Protection from creatures'] } } }]);
    engine.applyMutations(planDamage(engine.roomState, [{ source: captureSourceInformation(engine.roomState, source), recipient: { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }, amount: 2, combat: false }]));
    expect(engine.roomState.battlefield[1].state.damageTaken).toBe(2);
    engine.dispose();
  });

  it('damage removes loyalty and defense counters on each applicable card type', () => {
    const source = creature('source', 'player1');
    const base = creature('victim', 'player2', 2, 10);
    const victim = { ...base, blueprint: { ...base.blueprint, cardTypes: ['Creature', 'Planeswalker', 'Battle'] } };
    victim.state.counters = { loyalty: 5, defense: 6 };
    const room = createTestRoom({ battlefield: [source, victim] });
    const engine = new GameEngine(room);
    engine.applyMutations(planDamage(room, [{ source: captureSourceInformation(room, source), recipient: { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }, amount: 2, combat: false }]));
    expect(engine.roomState.battlefield[1].state.counters).toEqual({ loyalty: 3, defense: 4 });
    expect(engine.roomState.battlefield[1].state.damageTaken).toBe(2);
    engine.dispose();
  });
});
