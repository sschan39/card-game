import { useCallback, useReducer } from 'react';

/**
 * A deliberately small state machine.
 *
 * The front ends used to keep animation state in loose booleans and timers, which works
 * until two of them disagree: a panel still `closing` when it is handed a different card,
 * a toast whose countdown restarts and swallows the message before it. A transition table
 * makes those combinations explicit and impossible to reach by accident.
 *
 * Two rules keep it honest:
 *
 * 1. An event a state does not declare is ignored. A stray timeout can never move the
 *    machine somewhere it has no business being.
 * 2. Transitions are pure. Side effects — timers, `transitionend` listeners — stay in the
 *    component and are fired through `send`, so the tables can be tested without a renderer.
 */
export type TransitionTable<S extends string, E extends string> = {
  readonly [K in S]: Readonly<Partial<Record<E, S>>>;
};

export interface MachineConfig<S extends string, E extends string> {
  readonly initial: S;
  readonly states: TransitionTable<S, E>;
}

/** The pure core, exported so tables can be tested without React. */
export function reduce<S extends string, E extends string>(
  states: TransitionTable<S, E>,
  current: S,
  event: E,
): S {
  return states[current][event] ?? current;
}

/** React binding: the current state plus a stable `send`. */
export function useMachine<S extends string, E extends string>(
  config: MachineConfig<S, E>,
): readonly [S, (event: E) => void] {
  const { initial, states } = config;
  const [state, dispatch] = useReducer(
    (current: S, event: E) => reduce(states, current, event),
    initial,
  );
  const send = useCallback((event: E) => dispatch(event), []);
  return [state, send] as const;
}
