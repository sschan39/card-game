import { expect } from 'vitest';
import { act, passPriorityPair, type CardCase } from '../helpers/card-test-cases';
import { creature } from '../helpers/combat-fixture';

export default [{
  name: 'attack revives a friendly puppet and excludes the opponent’s puppet',
  covers: ['ability:stitch-attack'],
  prepare(room) {
    room.phase = 'declareAttackersStep';
    room.priorityPlayerId = null;
    room.battlefield[0].state.summoningSickness = false;
    for (const id of ['player1', 'player2']) {
      const puppet = creature(id + '-puppet', id);
      puppet.blueprint = { ...puppet.blueprint, subTypes: ['幻影木偶'] };
      puppet.state.zone = 'graveyard';
      room.players[id].graveyard.push(puppet);
    }
  },
  run(engine, source) {
    act(engine, 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] });
    passPriorityPair(engine);
    const choice = engine.roomState.pendingChoice;
    if (!choice || choice.kind === 'number') throw new Error('Expected the puppet choice');
    expect(choice.options.map(option => option.id)).toEqual(['player1-puppet']);
    act(engine, 'choose', { choiceId: choice.id, choices: ['player1-puppet'] });
    expect(engine.roomState.stack).toHaveLength(0);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'player1-puppet')?.state.summonKind).toBe('effect');
    expect(engine.roomState.players.player2.graveyard).toHaveLength(1);
  },
}] satisfies CardCase[];
