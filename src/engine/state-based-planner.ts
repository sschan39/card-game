import type { CardInstance } from '../types/card.types';
import type { GameRoom, PlayerLoss } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { ChoiceAnswer, PendingChoice } from '../types/choice.types';
import type { StateBasedBatch } from '../types/state-based.types';
import { CardCharacteristicService } from './card-characteristic-service';
import { roomCards } from './continuous-effects';
import { structuralTargetLegal } from '../shared/target-legality';
import { protectionApplies } from '../shared/protection';

export interface StateBasedPlan { mutations: GameMutation[]; pendingChoice?: PendingChoice }
const ref = (card: CardInstance) => ({ cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 });
const toGraveyard = (card: CardInstance): GameMutation => ({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: card.state.ownerId, from: 'battlefield', to: 'graveyard' });

function attachmentLegal(room: GameRoom, card: CardInstance, category: string): boolean {
  const value = CardCharacteristicService.resolve(room, card);
  if (card.state.attachedToPlayerId) return category === 'Aura' && !!room.players[card.state.attachedToPlayerId] &&
    (!value.attachmentRequirements || structuralTargetLegal(room, value.controllerId, { targetType: 'player', playerId: card.state.attachedToPlayerId }, value.attachmentRequirements));
  const host = card.state.attachedTo ? room.battlefield.find(c => c.uuid === card.state.attachedTo &&
    (card.state.attachedToRevision === undefined || (c.state.zoneRevision ?? 0) === card.state.attachedToRevision)) : undefined;
  if (!host || host.uuid === card.uuid || protectionApplies(room, host, card)) return false;
  if (category === 'Equipment') return CardCharacteristicService.resolveTypes(room, host).includes('Creature');
  if (category === 'Fortification') return CardCharacteristicService.resolveTypes(room, host).includes('Land');
  return !value.attachmentRequirements || structuralTargetLegal(room, value.controllerId,
    { targetType: 'permanent', cardUuid: host.uuid, zoneRevision: host.state.zoneRevision ?? 0 }, value.attachmentRequirements);
}
function hasWaitingTrigger(room: GameRoom, source: CardInstance, pending: GameMutation[]): boolean {
  const objects = [...room.stack, ...room.triggerQueue?.entries.map(entry => entry.object) ?? [],
    ...[...room.pendingTriggers ?? [], ...pending].flatMap(m => m.type === 'PUSH_STACK' ? [m.stackObject] : [])];
  return objects.some(object => object.type === 'triggered' && object.source.uuid === source.uuid && (object.source.state.zoneRevision ?? 0) === (source.state.zoneRevision ?? 0));
}

function finish(room: GameRoom, batch: StateBasedBatch): StateBasedPlan {
  const decision = batch.decisions.find(d => d.selected === undefined);
  if (decision) return { mutations: [], pendingChoice: { id: '', playerId: decision.playerId, kind: 'selection', prompt: decision.prompt,
    options: decision.options, min: 1, max: 1, continuation: { type: 'state_based', batch, decisionId: decision.id } } };
  // END_GAME freezes reducers, so all simultaneous changes precede it.
  const mutations: GameMutation[] = batch.mutations.filter(m => m.type !== 'END_GAME');
  for (const entry of batch.decisions) {
    if (entry.kind === 'legend') for (const option of entry.options) {
      const reference = option.value as ReturnType<typeof ref>;
      if ((entry.selected as ReturnType<typeof ref>).cardUuid !== reference.cardUuid) mutations.push(toGraveyard(room.battlefield.find(c => c.uuid === reference.cardUuid)!));
    }
    else if (entry.card) mutations.push({ type: 'SET_BATTLE_PROTECTOR', cardUuid: entry.card.cardUuid, playerId: entry.selected as string });
  }
  mutations.push(...batch.mutations.filter(m => m.type === 'END_GAME'));
  // Multiple simultaneous conditions removing one permanent produce one event.
  const removing = new Map<string, GameMutation>();
  for (const mutation of mutations) if (mutation.type === 'DESTROY_CARD' || mutation.type === 'MOVE_CARD')
    if (!removing.has(mutation.cardUuid) || mutation.type === 'MOVE_CARD') removing.set(mutation.cardUuid, mutation);
  const emitted = new Set<string>();
  return { mutations: mutations.flatMap(mutation => {
    if (mutation.type !== 'DESTROY_CARD' && mutation.type !== 'MOVE_CARD') return [mutation];
    if (emitted.has(mutation.cardUuid)) return [];
    emitted.add(mutation.cardUuid); return [removing.get(mutation.cardUuid)!];
  }) };
}

/** Gather one simultaneous batch from one characteristic snapshot. */
export function planStateBasedActions(room: GameRoom, pending: GameMutation[] = []): StateBasedPlan {
  if (room.status === 'gameOver' || room.outcome) return { mutations: [] };
  const batch: StateBasedBatch = { mutations: [], decisions: [], references: room.battlefield.map(ref), resumePriority: room.priorityPlayerId };
  const losses: PlayerLoss[] = Object.values(room.players).flatMap(player => [
    ...player.life <= 0 ? [{ playerId: player.id, reason: 'life_total' as const }] : [],
    ...(player.poison ?? 0) >= 10 ? [{ playerId: player.id, reason: 'poison' as const }] : [],
    ...player.failedDraw ? [{ playerId: player.id, reason: 'failed_draw' as const }] : [],
  ]);
  const legends = new Map<string, CardInstance[]>();
  const worlds: CardInstance[] = [];
  for (const card of roomCards(room)) {
    if (card.isToken && card.state.zone !== 'battlefield') batch.mutations.push({ type: 'CEASE_CARD', ...ref(card), playerId: card.state.ownerId, zone: card.state.zone });
    if (card.state.zone !== 'battlefield') continue;
    const value = CardCharacteristicService.resolve(room, card);
    if (value.cardTypes.includes('Creature')) {
      if (value.toughness <= 0) batch.mutations.push(toGraveyard(card));
      else if ((card.state.damageTaken > 0 && card.state.damageTaken >= value.toughness || card.state.deathtouchDamage) && !value.keywords.some(k => k.toLowerCase() === 'indestructible')) batch.mutations.push({ type: 'DESTROY_CARD', ...ref(card) });
    }
    if (card.state.deathtouchDamage) batch.mutations.push({ type: 'SET_DEATHTOUCH_DAMAGE', cardUuid: card.uuid, value: false });
    const opposing = Math.min(card.state.counters['+1/+1'] ?? 0, card.state.counters['-1/-1'] ?? 0);
    if (opposing > 0) batch.mutations.push({ type: 'REMOVE_COUNTER', cardUuid: card.uuid, counterType: '+1/+1', amount: opposing }, { type: 'REMOVE_COUNTER', cardUuid: card.uuid, counterType: '-1/-1', amount: opposing });
    if (value.cardTypes.includes('Planeswalker') && (card.state.counters.loyalty ?? 0) <= 0) batch.mutations.push(toGraveyard(card));
    if (value.cardTypes.includes('Battle')) {
      if ((card.state.counters.defense ?? 0) <= 0) {
        if (!value.subTypes.includes('Siege') || !hasWaitingTrigger(room, card, pending)) batch.mutations.push(toGraveyard(card));
      } else {
        const candidates = Object.keys(room.players).filter(playerId => value.subTypes.includes('Siege') ? playerId !== value.controllerId : playerId === value.controllerId);
        if (!candidates.includes(card.state.protectorId ?? '')) {
          if (!candidates.length) batch.mutations.push(toGraveyard(card));
          else if (candidates.length === 1) batch.mutations.push({ type: 'SET_BATTLE_PROTECTOR', cardUuid: card.uuid, playerId: candidates[0] });
          else batch.decisions.push({ id: `protector:${card.uuid}`, kind: 'protector', card: ref(card), playerId: value.controllerId, prompt: 'Choose a battle protector', options: candidates.map(id => ({ id, label: id, value: id })) });
        }
      }
    }
    const category = value.subTypes.find(type => ['Aura', 'Equipment', 'Fortification'].includes(type));
    const attached = !!card.state.attachedTo || !!card.state.attachedToPlayerId;
    if (category === 'Aura') {
      if (value.cardTypes.includes('Creature') || value.cardTypes.includes('Battle') || !attachmentLegal(room, card, category)) batch.mutations.push(toGraveyard(card));
    } else if (value.cardTypes.includes('Creature') || value.cardTypes.includes('Battle') || !category) {
      if (attached) batch.mutations.push({ type: 'UNATTACH_CARD', cardUuid: card.uuid });
    } else if (attached && !attachmentLegal(room, card, category)) batch.mutations.push({ type: 'UNATTACH_CARD', cardUuid: card.uuid });
    if (value.superTypes.includes('Legendary')) {
      const key = JSON.stringify([value.controllerId, value.name]); legends.set(key, [...legends.get(key) ?? [], card]);
    }
    if (value.superTypes.includes('World')) worlds.push(card);
  }
  for (const [id, cards] of legends) if (cards.length > 1) batch.decisions.push({ id, kind: 'legend', playerId: CardCharacteristicService.resolveController(room, cards[0]),
    prompt: `Choose a ${CardCharacteristicService.resolve(room, cards[0]).name} to keep`, options: cards.map(card => ({ id: card.uuid, label: card.blueprint.name, value: ref(card) })) });
  if (worlds.length > 1) {
    const newest = Math.max(...worlds.map(c => c.state.worldTimestamp ?? c.state.characteristicTimestamp ?? 0));
    const survivors = worlds.filter(c => (c.state.worldTimestamp ?? c.state.characteristicTimestamp ?? 0) === newest);
    for (const card of worlds) if (survivors.length > 1 || card !== survivors[0]) batch.mutations.push(toGraveyard(card));
  }
  if (losses.length) {
    const lost = new Set(losses.map(loss => loss.playerId));
    const survivors = Object.values(room.players).filter(player => !lost.has(player.id));
    batch.mutations.push({ type: 'END_GAME', outcome: survivors.length === 1 ? { type: 'win', winnerId: survivors[0].id, losses } : { type: 'draw', losses } });
  }
  batch.decisions.sort((a, b) => Number(a.playerId !== room.activeTurnPlayerId) - Number(b.playerId !== room.activeTurnPlayerId));
  return finish(room, batch);
}

export function answerStateBasedChoice(room: GameRoom, choice: PendingChoice, answer: ChoiceAnswer): StateBasedPlan {
  if (choice.continuation.type !== 'state_based' || answer.values.length !== 1) throw new Error('Invalid state-based decision');
  const batch = structuredClone(choice.continuation.batch);
  if (batch.references.some(reference => !room.battlefield.some(card => card.uuid === reference.cardUuid && (card.state.zoneRevision ?? 0) === reference.zoneRevision))) throw new Error('State-based decision is stale');
  const id = choice.continuation.decisionId;
  const decision = batch.decisions.find(d => d.id === id);
  if (!decision || decision.selected !== undefined || !decision.options.some(option => JSON.stringify(option.value) === JSON.stringify(answer.values[0]))) throw new Error('Invalid state-based selection');
  decision.selected = answer.values[0];
  return finish(room, batch);
}
