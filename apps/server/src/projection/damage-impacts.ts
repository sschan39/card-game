import type { DamageImpactView, ImpactAnchor } from '@card-game/protocol';
import type { CardInstance } from '@card-game/engine/types/card.types';
import type { AppliedGameEvent } from '@card-game/engine/types/game-event.types';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { sameCardObject } from '@card-game/engine/shared/card-identity';
import { canSeeStackSource } from './reveal-policy';

function permanent(card: CardInstance): ImpactAnchor {
  return { kind: 'permanent', cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 };
}

/** Project an applied hit without forwarding the source snapshot, cause, or rule data. */
export function projectDamageImpact(event: Extract<AppliedGameEvent, { eventId: 'DAMAGE_DEALT' }>,
    before: GameRoom | undefined, after: GameRoom, viewerId: string): DamageImpactView | undefined {
  const { recipient, card, combat, amount } = event.payload;
  if (amount <= 0) return;
  const oldTarget = before?.battlefield.find(value => value.uuid === recipient.cardUuid);
  const newTarget = after.battlefield.find(value => value.uuid === recipient.cardUuid);
  if (oldTarget && newTarget && !sameCardObject(oldTarget, newTarget)) return;
  const targetCard = oldTarget ?? newTarget;
  const target = targetCard ? permanent(targetCard)
    : recipient.playerId && Object.prototype.hasOwnProperty.call(after.players, recipient.playerId)
      ? { kind: 'player' as const, playerId: recipient.playerId } : undefined;
  if (!target) return;

  let source: ImpactAnchor | undefined;
  const stackUuid = event.cause?.stackUuid;
  for (const room of [before, after]) {
    if (!room || !card) continue;
    const object = combat ? undefined : room.stack.find(value => stackUuid
      ? value.uuid === stackUuid && value.source.uuid === card.uuid
      : value.type === 'spell' && sameCardObject(value.source, card));
    if (object && canSeeStackSource(room, viewerId, object)) {
      source = { kind: 'stack', stackUuid: object.uuid };
      break;
    }
    const visible = room.battlefield.find(value => sameCardObject(value, card));
    if (visible) {
      source = permanent(visible);
      break;
    }
  }
  const colors = source && !combat ? card?.lastKnownCharacteristics?.colors ?? card?.blueprint.colors : undefined;
  return { target, combat, ...(source ? { source } : {}), ...(colors?.length === 1 ? { color: colors[0] } : {}) };
}
