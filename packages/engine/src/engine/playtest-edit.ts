import { instantiateCard } from '../library/card-factory';
import { collectCards } from '../shared/card-query';
import { createCardState } from '../shared/card-state';
import { cardZonePlayer } from '../shared/card-visibility';
import { safeRuleKey } from '../shared/rule-path';
import { declarationPlayer } from '../shared/turn-utils';
import type { RuntimeContext } from '../shared/runtime-context';
import type { ActivatedAbility, CardBlueprint, CardInstance, CardVisibility } from '../types/card.types';
import type { ManaPool } from '../types/game.player.types';
import type { GameRoom } from '../types/game.room.types';
import type { Phase } from '../types/game.state.types';
import { nextEffectTimestamp } from './continuous-effects';
import { abilityAnnouncementDefinition, prepareAnnouncement, spellAnnouncementDefinition } from './announcement-values';
import type { ActionData } from './action-registry';
import { CardCharacteristicService } from './card-characteristic-service';
import { gameReducer } from './game-reducer';
import { createToken } from './token-creation';
import { planAbilityEffectsForStack } from './handlers/activate-ability-handler';
import { planSpellForStack } from './handlers/play-card-handler';
import { isManaAbility } from './mana-abilities';
import { captureSourceInformation } from './source-information';
import { newTurnHistory } from './turn-history';
import { moveCard, playerZoneKey } from './zone-transitions';

type Zone = 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'libraryTop' | 'libraryBottom' | 'hosted';
type Instance = { cardUuid: string; zoneRevision: number };
type Destination = { seat: 0 | 1; zone: Zone; host?: Instance & { visibility: CardVisibility } };
type Edit =
  | ({ kind: 'add'; cardId: string; quantity: number } & Destination)
  | { kind: 'stageSpell'; cardId: string; seat: 0 | 1; announcement?: ActionData }
  | ({ kind: 'stageAbility'; abilityId: string; announcement?: ActionData } & Instance)
  | ({ kind: 'move' } & Instance & Destination)
  | ({ kind: 'remove' } & Instance)
  | { kind: 'player'; seat: 0 | 1; life: number; mana: ManaPool; landPlaysUsed?: number }
  | (Instance & { kind: 'permanent'; tapped: boolean; summoningSickness: boolean; damage: number;
      counter?: { name: string; amount: number } })
  | { kind: 'turn'; seat: 0 | 1; priority: 0 | 1; turnNumber: number; phase: Phase }
  | { kind: 'token'; cardId: string; seat: 0 | 1; quantity: number }
  | ({ kind: 'attach'; hostUuid: string | null; hostRevision: number } & Instance)
  | ({ kind: 'modifier'; power: number; toughness: number; duration: 'END_OF_TURN' | 'WHILE_ON_BATTLEFIELD' } & Instance);

const zoneFor = (zone: Zone) => zone === 'libraryTop' || zone === 'libraryBottom' ? 'library' : zone;
const seatId = (room: GameRoom, seat: 0 | 1) => seat === 0 ? room.player1Id : room.player2Id!;
const seatLabel = (seat: 0 | 1) => seat === 0 ? 'Seat A' : 'Seat B';
const zoneLabel = (zone: Zone) => zone === 'libraryTop' ? 'top of library' : zone === 'libraryBottom' ? 'bottom of library' : zone;

/** Battlefield setup admits permanents that need no attachment target. */
export function canSetUpOnBattlefield(card: CardBlueprint): boolean {
  return card.cardTypes.some(type => ['Creature', 'Land', 'Artifact', 'Relic', 'Enchantment'].includes(type))
    && !card.subTypes?.includes('Aura');
}

/** Non-mana activations can be staged in the same source zones as normal activations. */
export function stageablePlaytestAbilities(room: GameRoom, card: CardInstance): ActivatedAbility[] {
  const zone = card.state.zone;
  if (zone !== 'hand' && zone !== 'battlefield') return [];
  return CardCharacteristicService.resolveAbilities(room, card).filter((ability): ability is ActivatedAbility =>
    ability.type === 'activated' && !isManaAbility(ability) && (ability.allowedZones ?? ['battlefield']).includes(zone));
}

function replaceBattlefieldCard(room: GameRoom, card: CardInstance): GameRoom {
  return { ...room, battlefield: room.battlefield.map(permanent => permanent.uuid === card.uuid ? card : permanent) };
}

function validateHost(room: GameRoom, edit: Destination) {
  if (edit.zone !== 'hosted') return;
  const host = edit.host;
  if (!host || !room.battlefield.some(card => card.uuid === host.cardUuid && (card.state.zoneRevision ?? 0) === host.zoneRevision))
    throw new Error('Choose a current battlefield card as host.');
  return { host: { cardUuid: host.cardUuid, zoneRevision: host.zoneRevision }, visibility: host.visibility };
}

function assertStackWindow(room: GameRoom) {
  if (room.engineState !== 'waiting_for_player' || !room.priorityPlayerId || declarationPlayer(room) || room.stack.length >= 30)
    throw new Error('Stage stack objects in an open priority window with room on the stack.');
}

function stageSpell(room: GameRoom, edit: Extract<Edit, { kind: 'stageSpell' }>, context: Pick<RuntimeContext, 'uuid'>) {
  assertStackWindow(room);
  const id = seatId(room, edit.seat), player = room.players[id];
  const card = instantiateCard(edit.cardId, context);
  if (card.blueprint.cardTypes.includes('Land')) throw new Error('Lands go directly to the battlefield.');
  card.state = createCardState(card.blueprint, id, id, 'hand');
  const supplied = { ...edit.announcement, stackUuid: context.uuid() };
  const staged = { ...room, players: { ...room.players, [id]: { ...player, hand: [...player.hand, card] } } };
  const blueprint = CardCharacteristicService.resolveBlueprint(staged, card);
  const announced = prepareAnnouncement(card, spellAnnouncementDefinition(blueprint), supplied);
  if (!announced.success) throw new Error(announced.reason);
  if (announced.missing || announced.missingCostRoute) {
    throw new Error('This card needs choices. Cast it through normal play or include the announcement in a board edit recipe.');
  }
  const plan = planSpellForStack(staged, id, card, supplied, announced.bindings);
  if (!plan.success) throw new Error(`${plan.reason}. Use a board edit recipe for targets and modes, or cast it through normal play.`);
  const result = moveCard(staged, {
    type: 'MOVE_CARD', cardUuid: card.uuid, playerId: id, from: 'hand', to: 'stack', stackObject: plan.stackObject,
  });
  if (result === staged) throw new Error('This card could not be staged on the stack.');
  return { room: { ...result, lastPassedPlayerId: null, priorityPlayerId: id },
    message: `Staged ${card.blueprint.name} on the stack for ${seatLabel(edit.seat)}.` };
}

/** Setup edits deliberately create no rule events. The room runtime installs the result as a checkpoint. */
export function applyPlaytestEdit(room: GameRoom, edit: Edit, context: Pick<RuntimeContext, 'uuid'>): { room: GameRoom; message: string } {
  const stagingStack = edit.kind === 'stageSpell' || edit.kind === 'stageAbility';
  const inFlight = room.stack.length || room.combat.length || room.combatDamage;
  if (room.status !== 'playing' || room.pendingChoice || room.triggerQueue || (!stagingStack && inFlight)) {
    throw new Error('Finish the current stack, choice or combat before editing the position. Undo and reset are still available.');
  }
  if (edit.kind === 'stageSpell') return stageSpell(room, edit, context);
  if (edit.kind === 'player') {
    const id = seatId(room, edit.seat);
    const history = room.turnHistory ?? newTurnHistory(room.turnNumber ?? 1);
    const turnHistory = edit.landPlaysUsed === undefined ? room.turnHistory
      : { ...history, landPlays: { ...history.landPlays, [id]: edit.landPlaysUsed } };
    const players = { ...room.players, [id]: { ...room.players[id], life: edit.life, mana: { ...edit.mana } } };
    return { room: { ...room, turnHistory, players },
      message: `Updated ${seatLabel(edit.seat)} resources.` };
  }
  if (edit.kind === 'turn') {
    const activeTurnPlayerId = seatId(room, edit.seat);
    const priorityPlayerId = edit.phase === 'declareAttackersStep' ? null : seatId(room, edit.priority);
    const restage = { ...room, engineState: 'waiting_for_player' as const, phase: edit.phase, activeTurnPlayerId, priorityPlayerId,
      turnNumber: edit.turnNumber, lastPassedPlayerId: null, combatDeclarations: undefined, combatDamage: null };
    const sameTurn = restage.turnNumber === room.turnNumber && activeTurnPlayerId === room.activeTurnPlayerId;
    const turnHistory = sameTurn ? room.turnHistory : newTurnHistory(edit.turnNumber);
    return { room: { ...restage, turnHistory }, message: `Staged turn ${edit.turnNumber} for ${seatLabel(edit.seat)}.` };
  }
  const allCards = collectCards(room);
  if (edit.kind === 'token') {
    if (allCards.length + edit.quantity > 2000 || room.battlefield.length + edit.quantity > 100) {
      throw new Error('The battlefield is full.');
    }
    let next = room;
    for (let index = 0; index < edit.quantity; index++) {
      const changed = createToken(next, {
        type: 'CREATE_TOKEN', tokenId: edit.cardId, cardUuid: context.uuid(), playerId: seatId(room, edit.seat),
        sequence: (next.tokenSequence ?? 0) + 1,
      });
      if (changed === next) throw new Error('Unknown token definition.');
      next = changed;
    }
    const name = next.battlefield[next.battlefield.length - 1].blueprint.name;
    return { room: next, message: `Added ${edit.quantity} × ${name} for ${seatLabel(edit.seat)}.` };
  }
  if (edit.kind === 'add') {
    const zone = zoneFor(edit.zone), id = seatId(room, edit.seat);
    const hosted = validateHost(room, edit);
    const player = room.players[id], key = playerZoneKey(zone);
    const existing = key ? player[key] ?? [] : room.battlefield;
    if (allCards.length + edit.quantity > 2000 || existing.length + edit.quantity > (key ? 500 : 100)) {
      throw new Error('This destination is full. Move a card before adding another.');
    }
    const cards = Array.from({ length: edit.quantity }, () => instantiateCard(edit.cardId, context));
    if (zone === 'battlefield' && !canSetUpOnBattlefield(cards[0].blueprint)) {
      throw new Error('This card needs to be cast or attached. Add it to a hand first.');
    }
    const timestamp = nextEffectTimestamp(room);
    cards.forEach((card, index) => {
      card.state = { ...createCardState(card.blueprint, id, id, zone), ...(zone === 'battlefield' ? {
        characteristicTimestamp: timestamp + index, isTapped: !!card.blueprint.entersTapped,
      } : {}), ...(hosted ? { hostedBy: { host: hosted.host }, visibility: hosted.visibility } : {}) };
    });
    const contents = edit.zone === 'libraryBottom' ? [...cards, ...existing] : [...existing, ...cards];
    const next = key ? { ...room, players: { ...room.players, [id]: { ...player, [key]: contents } } }
      : { ...room, battlefield: contents, effectTimestamp: timestamp + cards.length - 1 };
    const name = cards[0].blueprint.name;
    return { room: next, message: `Added ${edit.quantity} × ${name} to ${seatLabel(edit.seat)} ${zoneLabel(edit.zone)}.` };
  }
  const card = allCards.find(value => value.uuid === edit.cardUuid && (value.state.zoneRevision ?? 0) === edit.zoneRevision);
  if (!card) throw new Error('That card has changed. Select it again.');
  if (edit.kind === 'stageAbility') {
    assertStackWindow(room);
    const ability = stageablePlaytestAbilities(room, card).find(value => value.id === edit.abilityId);
    if (!ability) throw new Error('Choose a non-mana activated ability in its allowed zone.');
    const controllerId = card.state.zone === 'battlefield' ? CardCharacteristicService.resolveController(room, card) : cardZonePlayer(card);
    const action = edit.announcement ?? {};
    const announced = prepareAnnouncement(card, abilityAnnouncementDefinition(ability), action);
    if (!announced.success) throw new Error(announced.reason);
    if (announced.missing || announced.missingCostRoute) {
      throw new Error('This ability needs an announcement. Include it in a board edit recipe or activate it through normal play.');
    }
    const effects = planAbilityEffectsForStack(room, controllerId, card, ability, action);
    if (!effects.success) throw new Error(`${effects.reason}. Provide its targets or modes in a board edit recipe.`);
    const next = gameReducer(room, { type: 'PUSH_STACK', stackObject: {
      uuid: context.uuid(), type: 'activated', source: structuredClone(card), sourceInfo: captureSourceInformation(room, card),
      controllerId, ability, effects: effects.effects, targetGroups: effects.groups, countered: false, numericBindings: announced.bindings,
    } });
    return { room: { ...next, lastPassedPlayerId: null, priorityPlayerId: controllerId },
      message: `Staged ${card.blueprint.name}’s ${ability.id} ability.` };
  }
  if (edit.kind === 'attach') {
    if (card.state.zone !== 'battlefield' || !CardCharacteristicService.resolveSubTypes(room, card).includes('Equipment')) {
      throw new Error('Select an Equipment on the battlefield.');
    }
    const next = gameReducer(room, edit.hostUuid ? {
      type: 'ATTACH_CARD', cardUuid: card.uuid, zoneRevision: edit.zoneRevision, hostUuid: edit.hostUuid, hostRevision: edit.hostRevision,
      controllerId: CardCharacteristicService.resolveController(room, card),
    } : { type: 'UNATTACH_CARD', cardUuid: card.uuid });
    if (next === room) throw new Error('That Equipment cannot attach to the selected creature.');
    return { room: next, message: `${card.blueprint.name} ${edit.hostUuid ? 'attached' : 'detached'}.` };
  }
  if (edit.kind === 'permanent') {
    if (card.state.zone !== 'battlefield') throw new Error('Select a battlefield card.');
    const counters = { ...card.state.counters };
    if (edit.counter) {
      if (!safeRuleKey(edit.counter.name)) throw new Error('Invalid counter name.');
      if (edit.counter.amount === 0) delete counters[edit.counter.name];
      else counters[edit.counter.name] = edit.counter.amount;
    }
    const state = { ...card.state, counters, isTapped: edit.tapped,
      summoningSickness: edit.summoningSickness, damageTaken: edit.damage };
    return { room: replaceBattlefieldCard(room, { ...card, state }), message: `Updated ${card.blueprint.name}.` };
  }
  if (edit.kind === 'modifier') {
    if (card.state.zone !== 'battlefield' || !CardCharacteristicService.resolveTypes(room, card).includes('Creature')) {
      throw new Error('Select a creature on the battlefield.');
    }
    if (edit.power === 0 && edit.toughness === 0) throw new Error('Enter a power or toughness change.');
    const next = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: {
      source: card.uuid, sourceRevision: edit.zoneRevision, requiredZone: 'battlefield', origin: 'resolved',
      duration: edit.duration, layer: 7,
      scope: { cardUuid: card.uuid, zoneRevision: edit.zoneRevision, zones: ['battlefield'] },
      effect: { type: 'STAT_DELTA', power: edit.power, toughness: edit.toughness },
    } });
    return { room: next, message: `Added a power and toughness modifier to ${card.blueprint.name}.` };
  }
  if (edit.kind === 'remove') {
    if (card.state.attachedTo || room.battlefield.some(other => other.state.attachedTo === card.uuid) ||
        allCards.some(other => other.state.hostedBy?.host.cardUuid === card.uuid)) {
      throw new Error('Detach Equipment and move hosted cards before removing this permanent.');
    }
    const id = card.state.ownerId;
    const moved = card.state.zone === 'exile' ? room : moveCard(room, {
      type: 'MOVE_CARD', cardUuid: card.uuid, zoneRevision: edit.zoneRevision, playerId: cardZonePlayer(card), from: card.state.zone,
      to: 'exile', ...(card.state.hostedBy ? { fromHost: card.state.hostedBy.host } : {}),
    });
    if (moved === room && card.state.zone !== 'exile') throw new Error('This card cannot be removed from its current zone.');
    const player = moved.players[id];
    const exile = player.exile?.filter(value => value.uuid !== card.uuid);
    const next = { ...moved, players: { ...moved.players, [id]: { ...player, exile } } };
    return { room: next, message: `Removed ${card.blueprint.name} from the room.` };
  }
  const zone = zoneFor(edit.zone), id = seatId(room, edit.seat), from = card.state.zone;
  const toHost = validateHost(room, edit);
  if (card.isToken || card.state.attachedTo || room.battlefield.some(other => other.state.attachedTo === card.uuid)) {
    throw new Error('Resolve tokens and attachments through normal play.');
  }
  if (zone === 'battlefield' && !canSetUpOnBattlefield(card.blueprint)) {
    throw new Error('This card needs to be cast or attached. Move it to a hand first.');
  }
  if (zone !== 'hand' && zone !== 'battlefield' && id !== card.state.ownerId) {
    throw new Error('Choose the card owner for this destination.');
  }
  const key = playerZoneKey(zone);
  if (from === zone && zone === 'library') {
    const holder = room.players[id], rest = holder.deck.filter(value => value.uuid !== card.uuid);
    const deck = edit.zone === 'libraryTop' ? [...rest, card] : [card, ...rest];
    return { room: { ...room, players: { ...room.players, [id]: { ...holder, deck } } },
      message: `Moved ${card.blueprint.name} to ${zoneLabel(edit.zone)}.` };
  }
  if (from === 'battlefield' && zone === 'battlefield') {
    const state = { ...card.state, controllerId: id, summoningSickness: true };
    return { room: replaceBattlefieldCard(room, { ...card, state }),
      message: `${seatLabel(edit.seat)} now controls ${card.blueprint.name}.` };
  }
  if (from === 'hand' && zone === 'hand' && cardZonePlayer(card) !== id) {
    const holder = cardZonePlayer(card), current = room.players[holder], destination = room.players[id];
    if (destination.hand.length >= 500) throw new Error('This destination is full.');
    const moved = { ...card, state: { ...createCardState(card.blueprint, card.state.ownerId, id, 'hand'),
      zoneRevision: edit.zoneRevision + 1, ...(id !== card.state.ownerId ? { handHolderId: id } : {}) } };
    const players = { ...room.players, [holder]: { ...current, hand: current.hand.filter(value => value.uuid !== card.uuid) },
      [id]: { ...destination, hand: [...destination.hand, moved] } };
    return { room: { ...room, players }, message: `Moved ${card.blueprint.name} to ${seatLabel(edit.seat)} hand.` };
  }
  const count = key ? room.players[id][key]?.length ?? 0 : room.battlefield.length;
  if (count >= (key ? 500 : 100)) throw new Error('This destination is full.');
  const next = moveCard(room, {
    type: 'MOVE_CARD', cardUuid: card.uuid, zoneRevision: edit.zoneRevision, playerId: cardZonePlayer(card), from, to: zone,
    ...(from === 'hosted' ? { fromHost: card.state.hostedBy?.host } : {}), ...(toHost ? { toHost } : {}),
    ...(zone === 'battlefield' && { controllerId: id }),
    ...(zone === 'hand' && { handRecipientId: id }),
    ...(zone === 'library' && { libraryPlacement: edit.zone === 'libraryTop' ? 'top' : 'bottom' }),
  });
  if (next === room) throw new Error('That card cannot move to this destination.');
  return { room: next, message: `Moved ${card.blueprint.name} to ${seatLabel(edit.seat)} ${zoneLabel(edit.zone)}.` };
}
