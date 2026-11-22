import { expect } from 'vitest';
import { act, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import type { GameRoom } from '@shared/game.room.types';
import { creature } from '../helpers/combat-fixture';

function scorchTarget(room: GameRoom) {
  room.battlefield = [creature('scorch-target', 'player2')];
}

export default [
  {
    name: 'main-phase mode puts exactly two Scorch counters on an opposing creature',
    covers: ['mode:main-scorch'],
    prepare: scorchTarget,
    run(engine, source) {
      act(engine, 'cast_spell', { cardUuid: source.uuid, modes: ['main-scorch'],
        targets: [{ targetType: 'permanent', cardUuid: 'scorch-target' }] });
      resolveByPassing(engine);
      expect(engine.roomState.battlefield[0].state.counters.scorch).toBe(2);
      expect(engine.roomState.players.player2.life).toBe(20);
    },
  },
  {
    name: 'instant mode costs two red and deals five damage on the opposing turn',
    covers: ['play', 'mode:instant-damage'],
    prepare: room => { room.activeTurnPlayerId = 'player2'; },
    run(engine, source) {
      act(engine, 'cast_spell', { cardUuid: source.uuid, modes: ['instant-damage'],
        targets: [{ targetType: 'player', playerId: 'player2' }] });
      expect(engine.roomState.players.player1.mana.red).toBe(3);
      resolveByPassing(engine);
      expect(engine.roomState.players.player2.life).toBe(15);
      expect(engine.roomState.players.player1.graveyard.some(card => card.uuid === source.uuid)).toBe(true);
    },
  },
  {
    name: 'main-phase mode is rejected on the opposing turn without payment',
    prepare: room => { scorchTarget(room); room.activeTurnPlayerId = 'player2'; },
    run(engine, source) {
      const result = engine.executePlayerAction('player1', 'cast_spell', {
        cardUuid: source.uuid, modes: ['main-scorch'], targets: [{ targetType: 'permanent', cardUuid: 'scorch-target' }],
      });
      expect(result.success).toBe(false);
      expect(engine.roomState.players.player1.mana.red).toBe(5);
      expect(engine.roomState.players.player1.hand[0].uuid).toBe(source.uuid);
      expect(engine.roomState.stack).toHaveLength(0);
    },
  },
] satisfies CardCase[];
