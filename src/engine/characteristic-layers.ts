import type { CardBlueprint, CardInstance, ManaColor } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardCharacteristics, CharacteristicNumber, ContinuousEffectEntry } from '../types/continuous-effect.types';
import { characteristicScope, effectIsActive, effectSource, roomCards, scopeMatches } from './continuous-effects';
import { printedAbilities } from './printed-abilities';
import { nextEffectIndex } from './effect-ordering';

type LayerValue = CardCharacteristics & { abilityTimestamps: Record<string, number> };
type Board = Map<string, LayerValue>;
const colors: ManaColor[] = ['white', 'blue', 'black', 'red', 'green'];

function printed(blueprint: CardBlueprint, controllerId: string): LayerValue {
  return { name: blueprint.name, rulesText: blueprint.rulesText, cardTypes: [...blueprint.cardTypes], subTypes: [...blueprint.subTypes ?? []],
    colors: [...blueprint.colors ?? colors.filter(c => (blueprint.castRequirements.cost?.mana?.[c] ?? 0) > 0)],
    keywords: [...blueprint.keywords ?? []], abilities: printedAbilities(blueprint), controllerId,
    power: blueprint.power ?? 0, toughness: blueprint.toughness ?? 0, permissions: [], abilityTimestamps: {},
    castRequirements: structuredClone(blueprint.castRequirements), onCastEffects: structuredClone(blueprint.onCastEffects ?? []), onEnterEffects: structuredClone(blueprint.onEnterEffects ?? []),
    ...(blueprint.modes ? { modes: structuredClone(blueprint.modes) } : {}), ...(blueprint.modeCount ? { modeCount: { ...blueprint.modeCount } } : {}) };
}
function stage(entry: ContinuousEffectEntry): number {
  switch (entry.effect.type) {
    case 'COPY': return 1;
    case 'CONTROL': return 2;
    case 'TEXT': return 3;
    case 'TYPE': return 4;
    case 'COLOR': return 5;
    case 'ABILITY': return 6;
    case 'SET_STATS': return entry.characteristicDefining ? 70 : 71;
    case 'STAT_DELTA': return 72;
    case 'SWITCH_STATS': return 73;
    case 'PERMISSION': return 80;
  }
}
function staticEntries(cards: CardInstance[], board: Board): ContinuousEffectEntry[] {
  return cards.flatMap((source, index) => board.get(source.uuid)!.abilities.flatMap(ability => {
    if (ability.type !== 'static' || !(ability.activeZones ?? (ability.characteristicDefining ? ['battlefield', 'stack', 'hand', 'library', 'graveyard', 'exile'] : ['battlefield'])).includes(source.state.zone)) return [];
    return ability.effects.map((definition, part) => ({ ...definition, id: `static:${source.uuid}:${source.state.zoneRevision ?? 0}:${ability.id}:${part}`,
      groupId: `static:${source.uuid}:${source.state.zoneRevision ?? 0}:${ability.id}:${definition.group ?? 'effect'}`,
      origin: 'static' as const, characteristicDefining: ability.characteristicDefining, source: source.uuid, sourceRevision: source.state.zoneRevision ?? 0,
      sourceAbilityId: ability.id, timestamp: Math.max(board.get(source.uuid)!.abilityTimestamps[ability.id] ?? 0, source.state.characteristicTimestamp ?? index), requiredZone: source.state.zone, duration: 'PERMANENT' as const }));
  }));
}
function numberValue(value: CharacteristicNumber | undefined, entry: ContinuousEffectEntry, cards: CardInstance[], board: Board): number {
  if (value === undefined) return 0;
  if (typeof value === 'number') return value;
  const source = effectSource(cards, entry);
  const controller = source ? board.get(source.uuid)!.controllerId : entry.sourceControllerId;
  return cards.filter(c => scopeMatches(value.count, c, board.get(c.uuid)!, source, controller)).length * (value.multiply ?? 1) + (value.add ?? 0);
}
const list = <T>(old: T[], set?: T[], add?: T[], remove?: T[]): T[] => [...new Set([...(set ?? old), ...add ?? []])].filter(x => !remove?.includes(x));
function textChange<T>(value: T, replacements: Record<string, string>): T {
  if (typeof value === 'string') {
    const keys = Object.keys(replacements).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return (keys.length ? value.replace(new RegExp(`\\b(${keys.join('|')})\\b`, 'g'), word => replacements[word]) : value) as T;
  }
  if (Array.isArray(value)) return value.map(v => textChange(v, replacements)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ['id', 'cardUuid', 'controllerId', 'sourceControllerId'].includes(k) ? v : textChange(v, replacements)])) as T;
  return value;
}
function transform(value: LayerValue, entry: ContinuousEffectEntry, cards: CardInstance[], board: Board): LayerValue {
  const effect = entry.effect;
  switch (effect.type) {
    case 'COPY': {
      const copy = printed(effect.blueprint, value.controllerId);
      copy.abilityTimestamps = Object.fromEntries(copy.abilities.map(a => [a.id ?? '', entry.timestamp ?? 0]));
      return copy;
    }
    case 'CONTROL': return { ...value, controllerId: effect.controllerId };
    case 'TEXT': return { ...value, ...textChange({ rulesText: value.rulesText, cardTypes: value.cardTypes, subTypes: value.subTypes, keywords: value.keywords, abilities: value.abilities,
      onCastEffects: value.onCastEffects, onEnterEffects: value.onEnterEffects, modes: value.modes }, effect.replacements) };
    case 'TYPE': return { ...value, cardTypes: list(value.cardTypes, effect.set, effect.add, effect.remove), subTypes: list(value.subTypes, effect.setSubTypes, effect.addSubTypes, effect.removeSubTypes) };
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
      return { ...value, abilities: [...abilities, ...added],
      keywords: list(effect.removeAll ? [] : value.keywords, undefined, effect.addKeywords, effect.removeKeywords),
      onCastEffects: effect.removeAll ? [] : value.onCastEffects, onEnterEffects: effect.removeAll ? [] : value.onEnterEffects, modes: effect.removeAll ? undefined : value.modes,
      abilityTimestamps: { ...(effect.removeAll ? {} : value.abilityTimestamps), ...Object.fromEntries(added.map(a => [a.id, entry.timestamp ?? 0])) } };
    }
    case 'SET_STATS': return { ...value, power: numberValue(effect.power, entry, cards, board), toughness: numberValue(effect.toughness, entry, cards, board) };
    case 'STAT_DELTA': return { ...value, power: value.power + numberValue(effect.power, entry, cards, board), toughness: value.toughness + numberValue(effect.toughness, entry, cards, board) };
    case 'SWITCH_STATS': return { ...value, power: value.toughness, toughness: value.power };
    case 'PERMISSION': return { ...value, permissions: [...value.permissions, ...effect.rules.map(rule => ({ ...rule,
      sourceControllerId: entry.origin === 'resolved' ? entry.sourceControllerId : board.get(entry.source)?.controllerId ?? entry.sourceControllerId }))] };
  }
}
function applicable(entry: ContinuousEffectEntry, cards: CardInstance[], board: Board): boolean {
  if (!effectIsActive(cards, entry)) return false;
  if (!entry.sourceAbilityId) return true;
  return board.get(entry.source)?.abilities.some(a => a.id === entry.sourceAbilityId && a.type === 'static') ?? false;
}
function affected(entry: ContinuousEffectEntry, cards: CardInstance[], board: Board): CardInstance[] {
  if (!applicable(entry, cards, board)) return [];
  const source = effectSource(cards, entry);
  const controller = entry.origin === 'resolved' ? entry.sourceControllerId : source ? board.get(source.uuid)!.controllerId : entry.sourceControllerId;
  const scope = entry.effect.type === 'PERMISSION' ? entry.scope : characteristicScope(entry.scope);
  return cards.filter(c => scopeMatches(scope, c, board.get(c.uuid)!, source, controller));
}
function apply(entry: ContinuousEffectEntry, cards: CardInstance[], board: Board): Board {
  entry = currentStaticEntry(entry, cards, board);
  const next = new Map(board);
  for (const card of affected(entry, cards, board)) next.set(card.uuid, transform(board.get(card.uuid)!, entry, cards, board));
  return next;
}
/** Unstarted static definitions follow text/ability changes in the intermediate board. */
function currentStaticEntry(entry: ContinuousEffectEntry, cards: CardInstance[], board: Board): ContinuousEffectEntry {
  return entry.sourceAbilityId ? staticEntries(cards, board).find(current => current.id === entry.id) ?? entry : entry;
}
/** Compare the operation's effect, avoiding unrelated changes to its recipients. */
function signature(entry: ContinuousEffectEntry, cards: CardInstance[], board: Board): string {
  entry = currentStaticEntry(entry, cards, board);
  return JSON.stringify(affected(entry, cards, board).map(card => {
    const old = board.get(card.uuid)!;
    const effect = entry.effect;
    const operation = effect.type === 'SET_STATS' || effect.type === 'STAT_DELTA'
      ? { ...effect, power: numberValue(effect.power, entry, cards, board), toughness: numberValue(effect.toughness, entry, cards, board) }
      : effect.type === 'SWITCH_STATS' ? { type: effect.type, power: old.toughness, toughness: old.power } : effect;
    return [card.uuid, operation];
  }));
}
function fold(entries: ContinuousEffectEntry[], cards: CardInstance[], board: Board, layer: number,
  continuations: Map<string, ContinuousEffectEntry>, startedGroups: Set<string>): Board {
  const pending = [...entries].sort((a, b) => Number(!a.characteristicDefining) - Number(!b.characteristicDefining) || (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const seen = new Set(pending.map(e => e.id).filter(Boolean));
  while (pending.length) {
    for (let i = 0; i < pending.length; i++) pending[i] = currentStaticEntry(pending[i], cards, board);
    const ready = nextEffectIndex(pending, (a, b) => (!a.characteristicDefining && !!b.characteristicDefining) ||
      (!!a.characteristicDefining === !!b.characteristicDefining && signature(a, cards, board) !== signature(a, cards, apply(b, cards, board))));
    const [entry] = pending.splice(ready, 1);
    if (entry.groupId && !startedGroups.has(entry.groupId)) {
      startedGroups.add(entry.groupId);
      const objects = affected(entry, cards, board).map(c => ({ cardUuid: c.uuid, zoneRevision: c.state.zoneRevision ?? 0 }));
      for (const part of staticEntries(cards, board).filter(e => e.groupId === entry.groupId)) {
        continuations.set(part.id!, { ...part, sourceAbilityId: undefined, scope: { objects } });
      }
      for (let i = 0; i < pending.length; i++) pending[i] = continuations.get(pending[i].id ?? '') ?? pending[i];
    }
    board = apply(entry, cards, board);
    // Granted static abilities can contribute in the same layer. An entry is
    // applied at most once; removing/regranting it cannot create a query loop.
    for (const gained of staticEntries(cards, board)) if (stage(gained) === layer && !seen.has(gained.id)) {
      seen.add(gained.id); pending.push(continuations.get(gained.id!) ?? gained);
    }
    pending.sort((a, b) => Number(!a.characteristicDefining) - Number(!b.characteristicDefining) || (a.timestamp ?? 0) - (b.timestamp ?? 0));
  }
  return board;
}
/** Whole-board evaluation gives scopes and dependencies a common intermediate layer. */
export function resolveCharacteristics(room: GameRoom, requested: CardInstance, throughLayer = 80): CardCharacteristics {
  if (requested.lastKnownCharacteristics && !roomCards(room).some(c => c.uuid === requested.uuid && c.state.zone === requested.state.zone &&
    (c.state.zoneRevision ?? 0) === (requested.state.zoneRevision ?? 0))) return structuredClone(throughLayer === 1
      ? requested.lastKnownCopiableCharacteristics ?? printed(requested.blueprint, requested.state.controllerId) : requested.lastKnownCharacteristics);
  const cards = roomCards(room).filter(c => c.uuid !== requested.uuid || (c.state.zoneRevision ?? 0) === (requested.state.zoneRevision ?? 0));
  if (!cards.some(c => c.uuid === requested.uuid)) cards.push(requested);
  let board: Board = new Map(cards.map(c => [c.uuid, printed(c.blueprint, c.state.controllerId)]));
  const entries = room.continuousEffectPool.map((entry, index) => ({ ...entry, id: entry.id ?? `legacy:${index}`, timestamp: entry.timestamp ?? index }));
  const continuations = new Map<string, ContinuousEffectEntry>();
  const startedGroups = new Set<string>();
  for (const layer of [1, 2, 3, 4, 5, 6, 70, 71, 72, 73, 80]) {
    if (layer > throughLayer) break;
    if (layer === 73) for (const card of cards) {
      const value = board.get(card.uuid)!;
      const delta = (card.state.counters['+1/+1'] ?? 0) - (card.state.counters['-1/-1'] ?? 0);
      board.set(card.uuid, { ...value, power: value.power + delta, toughness: value.toughness + delta });
    }
    const statics = new Map(staticEntries(cards, board).map(e => [e.id!, e]));
    for (const [id, part] of continuations) statics.set(id, part);
    board = fold([...entries, ...statics.values()].filter(e => stage(e) === layer), cards, board, layer, continuations, startedGroups);
  }
  const { abilityTimestamps, ...result } = board.get(requested.uuid)!;
  return result;
}
