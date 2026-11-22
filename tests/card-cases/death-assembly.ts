import { expect } from 'vitest';
import { act, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { creature } from '../helpers/combat-fixture';

export default [false, true].map(protectedPuppet => ({
  name: protectedPuppet ? 'creates no token when one of the three puppets survives' : 'creates a 7/6 token after destroying all three puppets',
  covers: ['play', 'cast effects'],
  requires: ['token-phantom-stitch-monster'],
  prepare(room) {
    room.battlefield = Array.from({ length: 3 }, (_, index) => {
      const puppet = creature('puppet-' + index, 'player1', 2, 2, protectedPuppet && index === 0 ? ['Indestructible'] : []);
      puppet.blueprint = { ...puppet.blueprint, subTypes: ['幻影木偶'] };
      return puppet;
    });
  },
  run(engine, source) {
    const targets = engine.roomState.battlefield.map(card => ({ targetType: 'permanent', cardUuid: card.uuid }));
    act(engine, 'cast_spell', { cardUuid: source.uuid, targets });
    expect(engine.roomState.players.player1.mana.black).toBe(3);
    resolveByPassing(engine);
    expect(engine.roomState.players.player1.graveyard.filter(card => card.uuid.startsWith('puppet-')))
      .toHaveLength(protectedPuppet ? 2 : 3);
    const tokens = engine.roomState.battlefield.filter(card => card.isToken);
    if (protectedPuppet) {
      expect(tokens).toHaveLength(0);
    } else {
      expect(tokens).toHaveLength(1);
      expect(tokens[0].blueprint).toMatchObject({ id: 'token-phantom-stitch-monster', power: 7, toughness: 6 });
    }
  },
}) satisfies CardCase);
