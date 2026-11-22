import { expect } from 'vitest';
import { parseCardDefinition } from '@library/card-parser';
import { actionPermission } from '@rules/action-permissions';
import { targetPermissionsAllow } from '@rules/target-legality';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [4, 5].map(handSize => ({
  name: `protects an opposing graveyard and blocks hostile discard only below five cards (starts at ${handSize})`,
  covers: ['play', 'ability:deep-sea-protection'],
  prepare(room) {
    for (let count = 0; count < handSize; count++) room.players.player1.hand.push(fixtureCard('held-' + count, 'player1', 'hand'));
    room.players.player1.graveyard = [fixtureCard('own-grave', 'player1', 'graveyard')];
    room.players.player2.graveyard = [fixtureCard('enemy-grave', 'player2', 'graveyard')];
    const discard = parseCardDefinition({
      schemaVersion: 1, id: 'test-discard', cardTypes: ['Spell'],
      onCastEffects: [{ family: 'cards', operation: 'discard_random', params: { amount: 1 },
        targeting: { type: 'player', controller: 'opponent', all: true, required: false } }],
    });
    room.players.player2.hand = ['first-discard', 'second-discard'].map(id => fixtureCard(id, 'player2', 'hand', discard));
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 2 });
    resolveByPassing(engine);
    const check = (actor: string, cardUuid: string) => targetPermissionsAllow(engine.roomState, actor, source,
      { targetType: 'card', cardUuid, zone: 'graveyard', zoneRevision: 0 });
    expect(check('player1', 'enemy-grave')).toBe(false);
    expect(check('player2', 'enemy-grave')).toBe(false);
    expect(check('player2', 'own-grave')).toBe(true);
    expect(actionPermission(engine.roomState, 'player1', engine.roomState.players.player1.hand[0], 'affect').allowed).toBe(true);

    engine.roomState.activeTurnPlayerId = 'player2';
    engine.roomState.priorityPlayerId = 'player2';
    for (const id of ['first-discard', 'second-discard']) {
      act(engine, 'cast_spell', { cardUuid: id }, 'player2');
      resolveByPassing(engine);
      expect(engine.roomState.players.player1.hand).toHaveLength(4);
    }
    expect(engine.roomState.players.player1.graveyard).toHaveLength(handSize === 5 ? 2 : 1);
  },
}) satisfies CardCase);
