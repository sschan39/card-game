import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { act, resolveByPassing } from '../helpers/card-test-cases';
import { equipmentAttack } from '../helpers/equipment-card-case';

export default [equipmentAttack('幻影木偶', 'black', 1, engine => {
  const choice = engine.roomState.pendingChoice;
  if (choice?.kind !== 'targets') throw new Error('Expected the sword to ask for a target');
  expect(choice.options).toHaveLength(1);
  act(engine, 'choose', { choiceId: choice.id, choices: [choice.options[0].id] });
  resolveByPassing(engine);
  engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
  const enemy = engine.roomState.battlefield.find(card => card.uuid === 'equipment-enemy');
  if (!enemy) throw new Error('The target should have survived');
  expect(stats.resolveToughness(engine.roomState, enemy)).toBe(4);
  expect(enemy.state.damageTaken).toBe(0);
})];
