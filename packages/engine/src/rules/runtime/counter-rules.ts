import type { CardInstance } from '../../types/card.types';
import type { GameRoom } from '../../types/game.room.types';
import { compileStaticRules } from '../schema/compile';
import type { CounterDefinitions } from '../schema/counters';

function compileCounters(definitions: Readonly<CounterDefinitions>) {
  return new Map(Object.entries(definitions).map(([type, definition]) => [
    type, { type, ...definition, effects: compileStaticRules(definition.rules) },
  ] as const));
}

const compiled = new WeakMap<Readonly<CounterDefinitions>, ReturnType<typeof compileCounters>>();

function countersFor(room: GameRoom) {
  const definitions = room.matchContent?.counterDefinitions;
  if (!definitions) return;
  const cached = compiled.get(definitions);
  if (cached) return cached;
  const result = compileCounters(definitions);
  compiled.set(definitions, result);
  return result;
}

/** Read one definition per present counter type. Rules belong to the current battlefield holder. */
export function counterRulesFor(room: GameRoom, holder: CardInstance) {
  if (holder.state.zone !== 'battlefield') return [];
  const definitions = countersFor(room);
  if (!definitions) return [];
  return Object.entries(holder.state.counters).flatMap(([type, count]) => {
    const definition = definitions.get(type);
    return count > 0 && definition ? [definition] : [];
  });
}

/** The key survives counter removal and reapplication but distinguishes a returned card. */
export function counterRuleKey(holder: CardInstance, type: string): string {
  return 'counter:' + JSON.stringify([holder.uuid, holder.state.zoneRevision ?? 0, type]);
}

/** Compute a placement against the authored cap at the point it commits. */
export function counterCountAfterPlacement(room: GameRoom, type: string, current: number, amount: number): number {
  const cap = countersFor(room)?.get(type)?.maxPerCard;
  if (cap === undefined) return current + amount;
  return Math.min(cap, current + amount);
}
