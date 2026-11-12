import { counterRuleKey, counterRulesFor } from '../rules/runtime/counter-rules';
import { fixedManaValue } from '../shared/card-query';
import type { CardBlueprint, CardInstance } from '../types/card.types';
import { CARD_ZONES, MANA_COLORS } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardCharacteristics, CharacteristicNumber, ContinuousEffectEntry } from '../types/continuous-effect.types';
import { effectIsActive, effectSource, roomCards } from './continuous-effect-state';
import { characteristicScope, scopeMatches } from './effect-scopes';
import { printedAbilities } from './printed-abilities';
import { nextEffectIndex } from './effect-ordering';
import { createBoardNumericContext, requireCharacteristicNumber } from './numeric-characteristics';
import { hasNumericExpression } from './numeric-values';
import { conditionMatches } from '../shared/rule-condition-matcher';
import { operationStage } from '../rules/operation-stage';
import { permissionRuleMatches } from '../shared/permission-rule-matcher';

type LayerValue = CardCharacteristics & { abilityTimestamps: Record<string, number> };
type Board = Map<string, LayerValue>;
/** Observes committed continuous effects, after scope, dependency and uniqueness checks. */
export type AppliedCharacteristicObserver = (card: CardInstance, entry: ContinuousEffectEntry,
  before: CardCharacteristics, after: CardCharacteristics) => void;
type ProtectionEntry = ContinuousEffectEntry & { effect: Extract<ContinuousEffectEntry['effect'], { type: 'PERMISSION' }> };
const protectionEntries = new WeakMap<Board, ProtectionEntry[]>();

/** Build the printed (layer 0) characteristics of a card. */
function printed(blueprint: CardBlueprint, controllerId: string): LayerValue {
  return {
    name: blueprint.name,
    rulesText: blueprint.rulesText,
    cardTypes: [...blueprint.cardTypes],
    subTypes: [...blueprint.subTypes ?? []],
    superTypes: [...blueprint.superTypes ?? []],
    ...(blueprint.attachmentRequirements ? { attachmentRequirements: structuredClone(blueprint.attachmentRequirements) } : {}),
    colors: [...blueprint.colors ?? MANA_COLORS.filter(c => (blueprint.castRequirements.cost?.mana?.[c] ?? 0) > 0)],
    keywords: [...blueprint.keywords ?? []],
    abilities: printedAbilities(blueprint),
    controllerId,
    power: blueprint.power ?? 0,
    toughness: blueprint.toughness ?? 0,
    permissions: [],
    abilityTimestamps: {},
    numericDeclarations: structuredClone(blueprint.numericDeclarations ?? []),
    castRequirements: structuredClone(blueprint.castRequirements),
    onCastEffects: structuredClone(blueprint.onCastEffects ?? []),
    onEnterEffects: structuredClone(blueprint.onEnterEffects ?? []),
    ...(blueprint.modes ? { modes: structuredClone(blueprint.modes) } : {}),
    ...(blueprint.modeCount ? { modeCount: { ...blueprint.modeCount } } : {}),
  };
}

/** Map an effect type to the layer it applies in (lower layers run first). */
function stage(entry: ContinuousEffectEntry): number {
  return operationStage(entry.effect, entry.characteristicDefining);
}

/** Collect the static abilities currently active on the board as effect entries. */
function staticEntries(cards: CardInstance[], board: Board): ContinuousEffectEntry[] {
  return cards.flatMap((source, index) => {
    return board.get(source.uuid)!.abilities.flatMap(ability => {
      // Guard: a static ability only contributes from its active zones.
      if (ability.type !== 'static' || !(ability.activeZones ?? (ability.characteristicDefining
        ? CARD_ZONES
        : ['battlefield'])).includes(source.state.zone)) return [];

      return ability.effects.map((definition, part) => ({
        ...definition,
        id: `static:${source.uuid}:${source.state.zoneRevision ?? 0}:${ability.id}:${part}`,
        groupId: `static:${source.uuid}:${source.state.zoneRevision ?? 0}:${ability.id}:${definition.group ?? 'effect'}`,
        origin: 'static' as const,
        characteristicDefining: ability.characteristicDefining,
        source: source.uuid,
        sourceRevision: source.state.zoneRevision ?? 0,
        sourceAbilityId: ability.id,
        timestamp: Math.max(board.get(source.uuid)!.abilityTimestamps[ability.id] ?? 0, source.state.characteristicTimestamp ?? index),
        requiredZone: source.state.zone,
        duration: 'PERMANENT' as const,
      }));
    });
  });
}

/** Counter parts enter the same layers and group handling as printed static rules. */
function counterEntries(cards: CardInstance[]): ContinuousEffectEntry[] {
  return cards.flatMap(source => counterRulesFor(source).flatMap(counter => {
    const key = counterRuleKey(source, counter.type);
    return counter.effects.map((effect, index) => ({
      ...effect,
      id: `${key}:${index}`,
      /* v8 ignore next -- no counter rule authored in counters-v1.json declares a group. */
      groupId: `${key}:${effect.group ?? 'effect'}`,
      origin: 'static' as const,
      source: source.uuid,
      sourceRevision: source.state.zoneRevision ?? 0,
      requiredZone: source.state.zone,
      timestamp: source.state.characteristicTimestamp,
      duration: 'PERMANENT' as const,
    }));
  }));
}

/** Evaluate a characteristic number (which may be a dynamic expression) in board context. */
function numberValue(value: CharacteristicNumber | undefined, entry: ContinuousEffectEntry, cards: CardInstance[], board: Board, target?: CardInstance): number {
  if (value === undefined) return 0;

  const source = effectSource(cards, entry);
  const controller = source ? board.get(source.uuid)!.controllerId : entry.sourceControllerId;

  return requireCharacteristicNumber(value, createBoardNumericContext({
    cards,
    characteristics: card => board.get(card.uuid)!,
    source,
    target,
    controllerId: controller,
  }));
}

/** Apply set/add/remove semantics to a characteristic list. */
const list = <T>(old: T[], set?: T[], add?: T[], remove?: T[]): T[] => {
  return [...new Set([...(set ?? old), ...add ?? []])].filter(x => !remove?.includes(x));
};

/** Recursively substitute words in rules text and ability definitions. */
function textChange<T>(value: T, replacements: Record<string, string>): T {
  // A bound numeric expression is resolved later, not rewritten as text.
  if (hasNumericExpression(value) && value.numeric.kind === 'binding') return value;

  if (typeof value === 'string') {
    const keys = Object.keys(replacements).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    return (keys.length ? value.replace(new RegExp(`\\b(${keys.join('|')})\\b`, 'g'), word => replacements[word]) : value) as T;
  }

  if (Array.isArray(value)) return value.map(v => textChange(v, replacements)) as T;

  // Identity fields must never be rewritten by a text change.
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [
    k,
    [
      'id', 'ids', 'group', 'cardUuid', 'controllerId', 'sourceControllerId', 'numericDeclarations',
      'family', 'operation', 'action', 'type', 'kind', 'castSpeed', 'triggerCondition',
      'duration', 'period', 'identity', 'consume', 'mode',
    ].includes(k) ? v : textChange(v, replacements),
  ])) as T;

  return value;
}

/** Apply one continuous effect to a single card's characteristics. */
function transform(value: LayerValue, entry: ContinuousEffectEntry, cards: CardInstance[], board: Board, target: CardInstance): LayerValue {
  const effect = entry.effect;

  switch (effect.type) {
    case 'COPY': {
      const copy = printed(effect.blueprint, value.controllerId);

      copy.abilityTimestamps = Object.fromEntries(copy.abilities.map(a => [a.id!, entry.timestamp!]));

      return copy;
    }
    case 'CONTROL': return { ...value, controllerId: effect.controllerId };
    case 'TEXT': return {
      ...value,
      ...textChange({
        rulesText: value.rulesText,
        cardTypes: value.cardTypes,
        subTypes: value.subTypes,
        keywords: value.keywords,
        abilities: value.abilities,
        onCastEffects: value.onCastEffects,
        onEnterEffects: value.onEnterEffects,
        modes: value.modes,
      }, effect.replacements),
    };
    case 'TYPE': return {
      ...value,
      cardTypes: list(value.cardTypes, effect.set, effect.add, effect.remove),
      subTypes: list(value.subTypes, effect.setSubTypes, effect.addSubTypes, effect.removeSubTypes),
      superTypes: list(value.superTypes, effect.setSuperTypes, effect.addSuperTypes, effect.removeSuperTypes),
    };
    case 'MANA_COST': return { ...value, castRequirements: { ...value.castRequirements, cost: { ...value.castRequirements.cost, mana: { ...effect.mana } } } };
    case 'COLOR': return { ...value, colors: list(value.colors, effect.set, effect.add, effect.remove) };
    case 'ABILITY': {
      const abilities = (effect.removeAll ? [] : value.abilities).filter(a => !effect.removeIds?.includes(a.id ?? ''));
      const ids = new Set(abilities.map(a => a.id));
      const added = structuredClone(effect.add ?? []).map((ability, index) => {
        // Origin-qualified IDs survive other grants appearing or expiring.
        let id = `${ability.id ?? 'ability'}@${entry.id}:${index}`;

        while (ids.has(id)) id += ':';

        ids.add(id);

        return { ...ability, id };
      });

      return {
        ...value,
        abilities: [...abilities, ...added],
        keywords: list(effect.removeAll ? [] : value.keywords, undefined, effect.addKeywords, effect.removeKeywords),
        onCastEffects: effect.removeAll ? [] : value.onCastEffects,
        onEnterEffects: effect.removeAll ? [] : value.onEnterEffects,
        modes: effect.removeAll ? undefined : value.modes,
        abilityTimestamps: { ...(effect.removeAll ? {} : value.abilityTimestamps), ...Object.fromEntries(added.map(a => [a.id, entry.timestamp ?? 0])) },
      };
    }
    case 'SET_STATS': return {
      ...value,
      power: numberValue(effect.power, entry, cards, board, target),
      toughness: numberValue(effect.toughness, entry, cards, board, target),
    };
    case 'STAT_DELTA': return {
      ...value,
      power: value.power + numberValue(effect.power, entry, cards, board, target),
      toughness: value.toughness + numberValue(effect.toughness, entry, cards, board, target),
    };
    case 'SWITCH_STATS': return { ...value, power: value.toughness, toughness: value.power };
    case 'MILL_AMOUNT': {
      const millBonus = Math.min(Number.MAX_SAFE_INTEGER, (value.millBonus ?? 0) + effect.amount);
      return { ...value, millBonus };
    }
    case 'MANA_SUBSTITUTION': {
      if (!entry.sourceControllerId) return value;
      const playerId = entry.sourceControllerId;
      const existing = value.manaSubstitution;
      const colors = existing?.from === effect.from && existing.playerId === playerId
        ? [...new Set([...existing.colors, ...effect.colors])]
        : effect.colors;
      return { ...value, manaSubstitution: { from: effect.from, colors, playerId } };
    }
    case 'PERMISSION': return {
      ...value,
      permissions: [...value.permissions, ...effect.rules.map(rule => ({
        ...rule,
        sourceControllerId: entry.origin === 'resolved' ? entry.sourceControllerId : board.get(entry.source)?.controllerId ?? entry.sourceControllerId,
      }))],
    };
  }
}

/** True when the entry is still live and its granting ability still exists. */
function applicable(entry: ContinuousEffectEntry, cards: CardInstance[], board: Board): boolean {
  if (!effectIsActive(cards, entry)) return false;

  // A resolved effect has no granting ability to re-check.
  if (!entry.sourceAbilityId) return true;

  return board.get(entry.source)?.abilities.some(a => a.id === entry.sourceAbilityId && a.type === 'static') ?? false;
}
/** Resolve source-based immunity against the board as it stands at this layer. */
function sourceProtections(cards: CardInstance[], board: Board, room: GameRoom): ProtectionEntry[] {
  const cached = protectionEntries.get(board);
  if (cached) return cached;

  const entries = [...staticEntries(cards, board), ...counterEntries(cards), ...room.continuousEffectPool]
    .filter(hasSourceProtection);
  protectionEntries.set(board, entries);
  return entries;
}

function hasSourceProtection(entry: ContinuousEffectEntry): entry is ProtectionEntry {
  return entry.effect.type === 'PERMISSION' &&
    entry.effect.rules.some(rule => rule.action === 'affect' && rule.mode === 'prohibit' && rule.sourceCardTypes);
}

function sourceController(entry: ContinuousEffectEntry, board: Board): string | undefined {
  return entry.origin === 'resolved' ? entry.sourceControllerId
    : board.get(entry.source)?.controllerId ?? entry.sourceControllerId;
}

/** The cards this entry currently applies to. */
function affected(entry: ContinuousEffectEntry, cards: CardInstance[], board: Board, room: GameRoom): CardInstance[] {
  if (!applicable(entry, cards, board)) return [];

  const source = effectSource(cards, entry);
  const controller = entry.origin === 'resolved' ? entry.sourceControllerId : source ? board.get(source.uuid)!.controllerId : entry.sourceControllerId;
  const scope = entry.effect.type === 'PERMISSION' ? entry.scope : characteristicScope(entry.scope);
  const sourceTypes = entry.sourceCardTypes ?? (source ? board.get(source.uuid)?.cardTypes : undefined);

  // Permission grants establish immunity before evaluating incoming effects.
  const protectedCards = new Set<string>();
  if (controller && sourceTypes?.length && !hasSourceProtection(entry)) {
    for (const protection of sourceProtections(cards, board, room)) {
      const protector = sourceController(protection, board);
      const blocks = protection.effect.rules.some(rule => rule.sourceCardTypes && permissionRuleMatches({
        ...rule, sourceControllerId: protector,
      }, controller, 'affect', undefined, sourceTypes));
      if (blocks) for (const card of affected(protection, cards, board, room)) protectedCards.add(card.uuid);
    }
  }

  return cards.filter(c => {
    if (!scopeMatches(scope, c, board.get(c.uuid)!, source, controller) ||
        protectedCards.has(c.uuid)) return false;

    // Guard: an entry without a condition applies to every card in scope.
    if (!entry.condition) return true;

    const fields = {
      source: source ? { ...source, ...board.get(source.uuid), manaValue: fixedManaValue(board.get(source.uuid)!) } : undefined,
      target: { ...c, ...board.get(c.uuid), manaValue: fixedManaValue(board.get(c.uuid)!) },
      controller: controller ? room.players[controller] : undefined,
      room: { phase: room.phase, turnNumber: room.turnNumber ?? 1, activeTurnPlayerId: room.activeTurnPlayerId },
      history: { ...room.turnHistory, own: controller ? room.turnHistory?.playerCounts[controller] : undefined },
    };

    return conditionMatches(entry.condition, fields, createBoardNumericContext({
      cards,
      characteristics: card => board.get(card.uuid)!,
      source,
      controllerId: controller,
      fields,
      defaultCountZones: ['battlefield'],
    }));
  });
}

/** Apply one entry across every affected card, returning a new board. */
function apply(entry: ContinuousEffectEntry, cards: CardInstance[], board: Board, room: GameRoom,
  uniqueApplications: Set<string>, commit = false, observe?: AppliedCharacteristicObserver): Board {
  entry = currentStaticEntry(entry, cards, board);

  const next = new Map(board);

  const unique = entry.effect.type === 'STAT_DELTA' ? entry.effect.unique : undefined;
  const controller = entry.origin === 'resolved' ? entry.sourceControllerId
    : board.get(entry.source)?.controllerId ?? entry.sourceControllerId;
  for (const card of affected(entry, cards, board, room)) {
    if (unique) {
      const key = JSON.stringify([controller, unique, card.uuid]);
      if (uniqueApplications.has(key)) continue;
      if (commit) uniqueApplications.add(key);
    }
    const before = board.get(card.uuid)!;
    const after = transform(before, entry, cards, board, card);
    next.set(card.uuid, after);
    observe?.(card, entry, before, after);
  }

  return next;
}
/** Unstarted static definitions follow text/ability changes in the intermediate board. */
function currentStaticEntry(entry: ContinuousEffectEntry, cards: CardInstance[], board: Board): ContinuousEffectEntry {
  return entry.sourceAbilityId ? staticEntries(cards, board).find(current => current.id === entry.id) ?? entry : entry;
}

/** Compare the operation's effect, avoiding unrelated changes to its recipients. */
function signature(entry: ContinuousEffectEntry, cards: CardInstance[], board: Board, room: GameRoom): string {
  entry = currentStaticEntry(entry, cards, board);

  return JSON.stringify(affected(entry, cards, board, room).map(card => {
    const old = board.get(card.uuid)!;
    const effect = entry.effect;

    // Numeric effects are compared by their evaluated values, not their expressions.
    const operation = effect.type === 'SET_STATS' || effect.type === 'STAT_DELTA'
      ? { ...effect, power: numberValue(effect.power, entry, cards, board, card), toughness: numberValue(effect.toughness, entry, cards, board, card) }
      : effect.type === 'SWITCH_STATS' ? { type: effect.type, power: old.toughness, toughness: old.power } : effect;

    return [card.uuid, operation];
  }));
}

/** Apply every entry of one layer, respecting dependency order and grouping. */
function fold(entries: ContinuousEffectEntry[], cards: CardInstance[], board: Board, layer: number,
  continuations: Map<string, ContinuousEffectEntry>, startedGroups: Set<string>, room: GameRoom,
  counters: ContinuousEffectEntry[], observe?: AppliedCharacteristicObserver): Board {
  const pending = [...entries].sort((a, b) => Number(!a.characteristicDefining) - Number(!b.characteristicDefining) || (a.timestamp! - b.timestamp!));
  const seen = new Set(pending.map(e => e.id).filter(Boolean));
  const uniqueApplications = new Set<string>();

  while (pending.length) {
    // Refresh every pending entry against the board as it stands now.
    for (let i = 0; i < pending.length; i++) pending[i] = currentStaticEntry(pending[i], cards, board);

    // Pick the next entry whose result does not depend on another pending entry.
    const ready = nextEffectIndex(pending, (a, b) => (!a.characteristicDefining && !!b.characteristicDefining) ||
      (!!a.characteristicDefining === !!b.characteristicDefining && signature(a, cards, board, room) !== signature(a, cards, apply(b, cards, board, room, uniqueApplications), room)));
    const [entry] = pending.splice(ready, 1);

    // The first part of a group pins the group's recipients for the remaining parts.
    if (entry.groupId && !startedGroups.has(entry.groupId) && (!entry.condition || affected(entry, cards, board, room).length)) {
      startedGroups.add(entry.groupId);

      const objects = affected(entry, cards, board, room).map(c => ({ cardUuid: c.uuid, zoneRevision: c.state.zoneRevision ?? 0 }));

      for (const part of [...staticEntries(cards, board), ...counters].filter(e => e.groupId === entry.groupId)) {
        continuations.set(part.id!, { ...part, condition: undefined, sourceAbilityId: undefined, scope: { objects } });
      }

      for (let i = 0; i < pending.length; i++) pending[i] = continuations.get(pending[i].id!) ?? pending[i];
    }

    board = apply(entry, cards, board, room, uniqueApplications, true, observe);

    // Granted static abilities can contribute in the same layer. An entry is
    // applied at most once; removing/regranting it cannot create a query loop.
    for (const gained of staticEntries(cards, board)) {
      if (stage(gained) === layer && !seen.has(gained.id)) {
        seen.add(gained.id);
        pending.push(continuations.get(gained.id!) ?? gained);
      }
    }

    pending.sort((a, b) => Number(!a.characteristicDefining) - Number(!b.characteristicDefining) || (a.timestamp! - b.timestamp!));
  }

  return board;
}

/** Whole-board evaluation gives scopes and dependencies a common intermediate layer. */
export function resolveCharacteristics(room: GameRoom, requested: CardInstance, throughLayer = 80): CardCharacteristics {
  // A card that has left the room reports its last known characteristics.
  if (requested.lastKnownCharacteristics && !roomCards(room).some(c => c.uuid === requested.uuid && c.state.zone === requested.state.zone &&
    (c.state.zoneRevision ?? 0) === (requested.state.zoneRevision ?? 0))) return structuredClone(throughLayer === 1
      ? requested.lastKnownCopiableCharacteristics ?? printed(requested.blueprint, requested.state.controllerId) : requested.lastKnownCharacteristics);

  // Only the requested card's current incarnation participates in the evaluation.
  const cards = roomCards(room).filter(c => c.uuid !== requested.uuid || (c.state.zoneRevision ?? 0) === (requested.state.zoneRevision ?? 0));

  if (!cards.some(c => c.uuid === requested.uuid)) cards.push(requested);

  return resolveBoard(room, cards, throughLayer).get(requested.uuid)!;
}

/** Resolve a single immutable board evaluation for all current room objects. */
export function resolveRoomCharacteristics(room: GameRoom, throughLayer = 80,
  observe?: AppliedCharacteristicObserver): Map<CardInstance, CardCharacteristics> {
  const cards = roomCards(room);
  const board = resolveBoard(room, cards, throughLayer, observe);

  return new Map(cards.map(card => [card, board.get(card.uuid)!]));
}

/** Run every layer in order, starting from printed characteristics. */
function resolveBoard(room: GameRoom, cards: CardInstance[], throughLayer: number,
  observe?: AppliedCharacteristicObserver): Map<string, CardCharacteristics> {
  let board: Board = new Map(cards.map(c => [c.uuid, printed(c.blueprint, c.state.controllerId)]));
  const entries = room.continuousEffectPool.map((entry, index) => ({ ...entry, id: entry.id ?? `inline-effect:${index}`, timestamp: entry.timestamp ?? index }));
  const continuations = new Map<string, ContinuousEffectEntry>();
  const startedGroups = new Set<string>();
  const counters = counterEntries(cards);
  const counterIds = observe && new Set(counters.map(entry => entry.id));
  const observeEffect: AppliedCharacteristicObserver | undefined = observe && ((card, entry, before, after) => {
    if (entry.id === undefined || !counterIds?.has(entry.id)) observe(card, entry, before, after);
  });

  for (const layer of [1, 2, 3, 4, 5, 5.5, 6, 70, 71, 72, 73, 74, 75, 80]) {
    if (layer > throughLayer) break;

    // Layer 73 also folds in +1/+1 and -1/-1 counters.
    if (layer === 73) for (const card of cards) {
      const value = board.get(card.uuid)!;
      const delta = (card.state.counters['+1/+1'] ?? 0) - (card.state.counters['-1/-1'] ?? 0);

      board.set(card.uuid, { ...value, power: value.power + delta, toughness: value.toughness + delta });
    }

    const statics = new Map([...staticEntries(cards, board), ...counters].map(e => [e.id!, e]));

    for (const [id, part] of continuations) statics.set(id, part);

    board = fold([...entries, ...statics.values()].filter(e => stage(e) === layer), cards, board, layer, continuations, startedGroups, room, counters, observeEffect);
  }

  // Ability timestamps are bookkeeping only; strip them from the result.
  return new Map([...board].map(([uuid, { abilityTimestamps, ...result }]) => [uuid, result]));
}
