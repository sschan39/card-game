// tests/engine/lethal-damage.test.ts
// State-based action: a creature with lethal damage (damageTaken >= toughness)
// dies and moves to its owner's graveyard. Missing counterweight to SET_DAMAGE,
// which previously only recorded damage without ever destroying the creature.
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { lethalDamageMutations } from '../../src/engine/game-reducer';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

/** Put a creature under playerId's control on the battlefield, optional damage. */
function creatureOnBattlefield(room: GameRoom, playerId: string, damage: number) {
  const card = instantiateCard('empire-servant'); // 1/1 creature
  card.state.zone = 'battlefield';
  card.state.ownerId = playerId;
  card.state.controllerId = playerId;
  card.state.summoningSickness = false;
  card.state.isTapped = false;
  card.state.damageTaken = damage;
  room.battlefield.push(card);
  return card;
}

describe('lethalDamageMutations (pure)', () => {
  it('returns no mutations when no creature has lethal damage', () => {
    const room = createTestRoom();
    creatureOnBattlefield(room, 'player1', 0); // 1 toughness, 0 damage
    creatureOnBattlefield(room, 'player2', 0);
    expect(lethalDamageMutations(room)).toEqual([]);
  });

  it('destroys a creature whose damage meets its toughness', () => {
    const room = createTestRoom();
    const card = creatureOnBattlefield(room, 'player1', 1); // 1 >= 1 → lethal
    const muts = lethalDamageMutations(room);
    expect(muts).toHaveLength(1);
    expect(muts[0]).toMatchObject({
      type: 'MOVE_CARD',
      cardUuid: card.uuid,
      playerId: 'player1',
      from: 'battlefield',
      to: 'graveyard',
    });
  });

  it('destroys only the creature(s) with lethal damage', () => {
    const room = createTestRoom();
    creatureOnBattlefield(room, 'player1', 0); // survives
    const doomed = creatureOnBattlefield(room, 'player2', 2); // lethal (2 >= 1)
    const doomed2 = creatureOnBattlefield(room, 'player1', 1); // lethal
    const muts = lethalDamageMutations(room);
    const doomedUuids = muts.map(m => m.cardUuid).sort();
    expect(doomedUuids).toEqual([doomed.uuid, doomed2.uuid].sort());
  });

  it('never destroys a non-creature permanent from damage', () => {
    const room = createTestRoom();
    const nonCreature = instantiateCard('land-red');
    nonCreature.state.zone = 'battlefield';
    nonCreature.state.ownerId = 'player1';
    nonCreature.state.controllerId = 'player1';
    nonCreature.state.damageTaken = 5;
    room.battlefield.push(nonCreature);
    expect(lethalDamageMutations(room)).toEqual([]);
  });
});

describe('lethal damage through applyMutations', () => {
  it('moves a lethally damaged creature to its owner graveyard', () => {
    const room = createTestRoom();
    const card = creatureOnBattlefield(room, 'player1', 0);
    const engine = new GameEngine(room);

    // Damage dealt by some effect flows through applyMutations as SET_DAMAGE.
    const applied = engine.applyMutations([
      { type: 'SET_DAMAGE', cardUuid: card.uuid, amount: 1 },
    ]);

    // The lethal-damage SBA appended a MOVE_CARD to the applied batch.
    const killMutations = applied.filter(m => m.type === 'MOVE_CARD');
    expect(killMutations.length).toBeGreaterThan(0);

    // Creature left the battlefield and now lies in player1's graveyard.
    const onBattlefield = engine.roomState.battlefield.find(c => c.uuid === card.uuid);
    expect(onBattlefield).toBeUndefined();
    const inGraveyard = engine.roomState.players['player1'].graveyard.find(c => c.uuid === card.uuid);
    expect(inGraveyard).toBeDefined();
    expect(inGraveyard!.state.zone).toBe('graveyard');
  });

  it('keeps a creature that survives non-lethal damage on the battlefield', () => {
    const room = createTestRoom();
    const card = creatureOnBattlefield(room, 'player1', 0);
    const engine = new GameEngine(room);

    // 1/1 takes 0 damage → survives. damageTaken stays 0.
    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: 0 }]);

    expect(engine.roomState.battlefield.find(c => c.uuid === card.uuid)).toBeDefined();
    expect(
      engine.roomState.players['player1'].graveyard.find(c => c.uuid === card.uuid)
    ).toBeUndefined();
  });
});