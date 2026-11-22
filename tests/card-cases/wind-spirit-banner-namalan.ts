import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { instantiateCard } from '@library/card-factory';
import { castWithPayment, choose, chooseTarget, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(ready => ({
  name: `silences tapped opposing creatures and can ready one Wind Beast on a new opposing tap during friendly combat (${ready})`,
  covers: ['play', 'ability:silence-tapped', 'ability:ready-wind-spirit'],
  requires: ['sea-patrol'],
  prepare(room) {
    const ally = fixtureCard('beast', 'player1', 'battlefield', { name: '風靈獸 ally' });
    const ordinary = fixtureCard('ordinary', 'player1', 'battlefield');
    const enemy = instantiateCard('sea-patrol');
    enemy.uuid = 'enemy';
    enemy.state = { ...enemy.state, zone: 'battlefield', ownerId: 'player2', controllerId: 'player2' };
    ally.state.isTapped = true;
    ordinary.state.isTapped = true;
    room.battlefield = [ally, ordinary, enemy];
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 3, red: 1 });
    resolveByPassing(engine);
    const abilities = () => stats.resolveAbilities(engine.roomState, permanent(engine, 'enemy'));
    const tapped = () => permanent(engine, 'beast').state.isTapped;
    expect(abilities().map(ability => ability.id)).toEqual(['entry-library-discard']);
    const tap = { type: 'TAP_CARD', cardUuid: 'enemy' } as const;
    const untap = { type: 'UNTAP_CARD', cardUuid: 'enemy' } as const;
    engine.applyMutations([tap]);
    expect(abilities()).toEqual([]);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(tapped()).toBe(true);
    engine.applyMutations([untap, { type: 'SET_PHASE', phase: 'beginCombatStep' }, tap]);
    chooseTarget(engine, 'beast', ['beast']);
    passPriorityPair(engine);
    choose(engine, [ready ? 'yes' : 'no']);
    expect(tapped()).toBe(!ready);
    expect(abilities()).toEqual([]);
    engine.applyMutations([untap]);
    expect(abilities().map(ability => ability.id)).toEqual(['entry-library-discard']);
    if (ready) {
      engine.applyMutations([{ type: 'TAP_CARD', cardUuid: 'beast' }, tap]);
      expect(engine.roomState.stack).toEqual([]);
      expect(engine.roomState.pendingChoice).toBeFalsy();
      expect(tapped()).toBe(true);
    }
  },
}) satisfies CardCase);
