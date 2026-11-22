import { expect } from 'vitest';
import { planDamage } from '@engine/damage-service';
import { captureSourceInformation } from '@engine/source-information';
import { targetPermissionsAllow } from '@rules/target-legality';
import { castWithPayment, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'protects friendly Yuer against hostile creature and spell effects, and readies only on a matching tap during enemy combat',
  covers: ['play', 'ability:worlds-winter-protection', 'ability:ready-kasnas'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('yuer', 'player1', 'battlefield', { subTypes: ['幽爾'], toughness: 8 }),
      fixtureCard('other', 'player1', 'battlefield', { toughness: 8 }),
      fixtureCard('enemy', 'player2', 'battlefield', { subTypes: ['幽爾'] }),
      fixtureCard('relic', 'player2', 'battlefield', { cardTypes: ['Artifact'] }),
    ];
    room.players.player2.hand.push(fixtureCard('spell', 'player2', 'hand', { cardTypes: ['Spell'] }));
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 3 });
    resolveByPassing(engine);
    const kasnas = () => permanent(engine, source.uuid);
    const target = { targetType: 'permanent' as const, cardUuid: 'yuer' };
    const candidates = [permanent(engine, 'enemy'), engine.roomState.players.player2.hand[0], permanent(engine, 'relic')];
    expect(candidates.map(card => targetPermissionsAllow(engine.roomState, 'player2', card, target))).toEqual([false, false, true]);
    expect(targetPermissionsAllow(engine.roomState, 'player1', kasnas(), target)).toBe(true);
    const damage = (cardUuid: string, dealer: string, combat: boolean, amount: number) => ({
      source: captureSourceInformation(engine.roomState, permanent(engine, dealer)),
      recipient: { kind: 'permanent' as const, cardUuid, zoneRevision: permanent(engine, cardUuid).state.zoneRevision ?? 0 },
      amount, combat,
    });
    engine.applyMutations(planDamage(engine.roomState, [
      damage(source.uuid, 'enemy', false, 3), damage(source.uuid, 'enemy', true, 1),
      damage(source.uuid, 'relic', false, 1), damage('other', 'enemy', false, 1),
    ]));
    expect(kasnas().state.damageTaken).toBe(2);
    expect(permanent(engine, 'other').state.damageTaken).toBe(1);
    const tapYuer = { type: 'TAP_CARD', cardUuid: 'yuer' } as const;
    engine.applyMutations([{ type: 'TAP_CARD', cardUuid: source.uuid }, { type: 'SET_PHASE', phase: 'beginCombatStep' }, tapYuer]);
    expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([{ type: 'UNTAP_CARD', cardUuid: 'yuer' }]);
    engine.roomState.activeTurnPlayerId = 'player2';
    engine.applyMutations([{ type: 'TAP_CARD', cardUuid: 'other' }, { type: 'TAP_CARD', cardUuid: 'enemy' }]);
    expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([tapYuer]);
    resolveByPassing(engine);
    expect(kasnas().state.isTapped).toBe(false);
    expect(permanent(engine, 'yuer').state.isTapped).toBe(true);
  },
}] satisfies CardCase[];
