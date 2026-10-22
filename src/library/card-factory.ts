// src/library/card-factory.ts
import type { CardInstance } from '../types/card.types';
import { createCardState } from '../shared/card-state';
import { defaultRuntimeContext, type RuntimeContext } from '../shared/runtime-context';
import { getBlueprint } from './card-catalog';
export { getBlueprint } from './card-catalog';

export function instantiateCard(
  cardId: string,
  context: Pick<RuntimeContext, 'uuid'> = defaultRuntimeContext,
): CardInstance {
  const blueprint = getBlueprint(cardId);

  const instance: CardInstance = {
    blueprint,
    uuid: context.uuid(),
    state: createCardState(blueprint, '', '', 'library'),
  };

  return instance;
}

export default { getBlueprint, instantiateCard };
