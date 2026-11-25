import type { CardInstance } from '@card-game/engine/types/card.types';
import { createCardState } from '@card-game/engine/shared/card-state';
import { defaultRuntimeContext, type RuntimeContext } from '@card-game/engine/shared/runtime-context';
import { getBlueprint, getTokenBlueprint, isTokenDefinition } from './card-catalog';
export { getBlueprint } from './card-catalog';

export function getPlayableBlueprint(cardId: string) {
  if (isTokenDefinition(cardId)) throw new Error('Use the token factory for token definitions');
  return getBlueprint(cardId);
}

export function instantiateCard(
  cardId: string,
  context: Pick<RuntimeContext, 'uuid'> = defaultRuntimeContext,
): CardInstance {
  const blueprint = getPlayableBlueprint(cardId);

  const instance: CardInstance = {
    blueprint,
    uuid: context.uuid(),
    state: createCardState(blueprint, '', '', 'library'),
  };

  return instance;
}

export default { getBlueprint, instantiateCard, instantiateToken };

/** A token is born on the battlefield; its lifecycle flag is independent of printed or granted abilities. */
export function instantiateToken(
  tokenId: string,
  ownerId: string,
  context: Pick<RuntimeContext, 'uuid'> = defaultRuntimeContext,
): CardInstance {
  const blueprint = getTokenBlueprint(tokenId);
  return {
    blueprint,
    uuid: context.uuid(),
    isToken: true,
    state: { ...createCardState(blueprint, ownerId, ownerId, 'battlefield'), zoneRevision: 0, summonKind: 'effect' },
  };
}
