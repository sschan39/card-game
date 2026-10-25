import { describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import type { CardInstance } from '@shared/card.types';

const permanent = (uuid: string, types: string[], subTypes: string[] = [], owner = 'player1'): CardInstance => {
  const card = creature(uuid, owner);
  return { ...card, blueprint: { ...card.blueprint, cardTypes: types, subTypes } };
};
const settle = (cards: CardInstance[]) => {
  const engine = new GameEngine(createTestRoom({ battlefield: cards }));
  engine.applyMutations([{ type: 'SET_LAST_PASSED', playerId: null }]);
  return engine;
};
function choose(engine: GameEngine, id: string) {
  const choice = engine.roomState.pendingChoice!;
  return engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: [id] });
}

describe('extended simultaneous state-based settlement', () => {
  it('separates zero toughness from destruction and converges for indestructible lethal damage', () => {
    const zero = creature('zero', 'player1', 2, 0, ['Indestructible']);
    const lethal = creature('lethal', 'player1', 2, 4, ['Indestructible']); lethal.state.damageTaken = 4;
    const engine = settle([zero, lethal]);
    expect(engine.roomState.battlefield.map(c => c.uuid)).toEqual(['lethal']);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toEqual(['zero']);
    expect(engine.hasPendingRulesWork).toBe(false); engine.dispose();
  });

  it('keeps a token death event then removes the token from its graveyard', () => {
    const token = { ...creature('token', 'player1', 1, 1), isToken: true }; token.state.damageTaken = 1;
    const engine = settle([token]);
    expect(engine.roomState.battlefield).toEqual([]);
    expect(engine.roomState.players.player1.graveyard).toEqual([]);
    expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'PERMANENT_DIED')).toHaveLength(1);
    engine.dispose();
  });

  it('moves illegal Auras but detaches illegal Equipment and non-attachment creatures', () => {
    const aura = permanent('aura', ['Enchantment'], ['Aura']);
    const equipment = permanent('equipment', ['Artifact'], ['Equipment']); equipment.state.attachedTo = 'gone';
    const creatureAttachment = creature('attached-creature', 'player1'); creatureAttachment.state.attachedTo = 'gone';
    const engine = settle([aura, equipment, creatureAttachment]);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toEqual(['aura']);
    expect(engine.roomState.battlefield.map(c => c.state.attachedTo)).toEqual([null, null]);
    engine.dispose();
  });

  it('uses host incarnation, enchant restrictions and protection rather than targeting restrictions', () => {
    const host = creature('host', 'player1', 2, 4, ['Shroud']);
    const auraBase = permanent('aura', ['Enchantment'], ['Aura']);
    const aura = { ...auraBase, blueprint: { ...auraBase.blueprint, attachmentRequirements: { type: 'permanent' as const, cardTypes: ['Creature'] } } };
    aura.state.attachedTo = 'host'; aura.state.attachedToRevision = 0;
    const engine = settle([host, aura]);
    expect(engine.roomState.battlefield).toHaveLength(2);
    engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'host', layer: 6, scope: { cardUuid: 'host' }, duration: 'PERMANENT', effect: { type: 'ABILITY', addKeywords: ['Protection from enchantments'] } } }]);
    expect(engine.roomState.battlefield.map(c => c.uuid)).toEqual(['host']);
    engine.dispose();
    host.state.zoneRevision = 1;
    const stale = settle([host, aura]);
    expect(stale.roomState.battlefield.map(c => c.uuid)).toEqual(['host']); stale.dispose();
  });

  it('removes an Aura that is a creature whether attached or unattached', () => {
    for (const attached of [false, true]) {
      const host = creature('host', 'player1');
      const aura = permanent('animated-aura', ['Creature', 'Enchantment'], ['Aura']);
      if (attached) aura.state.attachedTo = host.uuid;
      const engine = settle([host, aura]);
      expect(engine.roomState.battlefield.map(c => c.uuid)).toEqual(['host']);
      expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toEqual(['animated-aura']);
      engine.dispose();
    }
  });

  it('collects legend decisions in active-player order before applying any of the batch', () => {
    const legends = ['a', 'b', 'c', 'd'].map((uuid, index) => {
      const card = creature(uuid, index < 2 ? 'player1' : 'player2');
      return { ...card, blueprint: { ...card.blueprint, name: 'Same name', superTypes: ['Legendary'] } };
    });
    const zero = creature('zero', 'player1', 0, 0);
    const engine = settle([...legends, zero]);
    expect(engine.roomState.pendingChoice?.playerId).toBe('player1');
    expect(engine.roomState.battlefield).toHaveLength(5);
    expect(choose(engine, 'a').success).toBe(true);
    expect(engine.roomState.pendingChoice?.playerId).toBe('player2');
    expect(engine.roomState.battlefield).toHaveLength(5);
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState)));
    expect(choose(restored, 'd').success).toBe(true);
    expect(restored.roomState.battlefield.map(c => c.uuid)).toEqual(['a', 'd']);
    expect(restored.roomState.players.player1.graveyard.map(c => c.uuid).sort()).toEqual(['b', 'zero']);
    expect(restored.roomState.players.player2.graveyard.map(c => c.uuid)).toEqual(['c']);
    expect(restored.roomState.priorityPlayerId).toBe('player1');
    engine.dispose(); restored.dispose();
  });

  it('keeps the newest world permanent and removes all worlds on a timestamp tie', () => {
    const world = (uuid: string, timestamp: number) => {
      const card = permanent(uuid, ['Enchantment']); card.state.characteristicTimestamp = timestamp;
      return { ...card, blueprint: { ...card.blueprint, superTypes: ['World'] } };
    };
    const engine = settle([world('old', 1), world('new', 2)]);
    expect(engine.roomState.battlefield.map(c => c.uuid)).toEqual(['new']); engine.dispose();
    const tied = settle([world('a', 2), world('b', 2)]);
    expect(tied.roomState.battlefield).toEqual([]); tied.dispose();
  });

  it('removes zero-loyalty and zero-defense permanents while respecting waiting Siege triggers', () => {
    const walker = permanent('walker', ['Planeswalker']); walker.state.counters.loyalty = 0;
    const battle = permanent('battle', ['Battle']); battle.state.counters.defense = 0; battle.state.protectorId = 'player1';
    const engine = settle([walker, battle]);
    expect(engine.roomState.battlefield).toEqual([]); engine.dispose();
    const siege = permanent('siege', ['Battle'], ['Siege']); siege.state.counters.defense = 0; siege.state.protectorId = 'player2';
    const waiting = new GameEngine(createTestRoom({ battlefield: [siege], stack: [{ type: 'triggered', uuid: 'defeat', source: siege, controllerId: 'player1', countered: false, effects: [] }] }));
    waiting.applyMutations([{ type: 'SET_LAST_PASSED', playerId: null }]);
    expect(waiting.roomState.battlefield).toHaveLength(1);
    expect(waiting.resolveTopOfStack().success).toBe(true);
    expect(waiting.roomState.battlefield).toEqual([]); waiting.dispose();
  });

  it('cancels opposing counters and retains pre-batch LKI for a simultaneous death', () => {
    const card = creature('counters', 'player1', 1, 1); card.state.counters = { '+1/+1': 1, '-1/-1': 3 };
    const survivor = creature('survivor', 'player1', 2, 4); survivor.state.counters = { '+1/+1': 2, '-1/-1': 1 };
    const engine = settle([card, survivor]);
    expect(engine.roomState.battlefield[0].state.counters).toEqual({ '+1/+1': 1, '-1/-1': 0 });
    const death = engine.drainEventBatches().flatMap(b => b.events).find(e => e.eventId === 'PERMANENT_DIED');
    expect(death?.payload.snapshot.card.state.counters).toEqual({ '+1/+1': 1, '-1/-1': 3 }); engine.dispose();
  });

  it('settles simultaneous life, poison and failed-draw losses without iteration-order winners', () => {
    const room = createTestRoom(); room.players.player1.life = 0; room.players.player2.poison = 10;
    const engine = new GameEngine(room); engine.applyMutations([{ type: 'SET_LAST_PASSED', playerId: null }]);
    expect(engine.roomState.outcome).toMatchObject({ type: 'draw', losses: [{ playerId: 'player1', reason: 'life_total' }, { playerId: 'player2', reason: 'poison' }] }); engine.dispose();
    const failed = new GameEngine(createTestRoom());
    failed.applyMutations([{ type: 'DRAW_CARDS', playerId: 'player1', amount: 1 }, { type: 'DRAW_CARDS', playerId: 'player2', amount: 1 }]);
    expect(failed.roomState.outcome?.type).toBe('draw'); failed.dispose();
  });
});
