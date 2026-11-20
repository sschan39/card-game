import { describe, expect, it } from 'vitest';
import { reduce, type TransitionTable } from '../../packages/ui/src/machine';

type State = 'idle' | 'running' | 'done';
type Event = 'START' | 'STOP' | 'FINISH';

/** A three-state table with one dead end, enough to exercise every rule. */
const states: TransitionTable<State, Event> = {
  idle: { START: 'running' },
  running: { STOP: 'idle', FINISH: 'done' },
  done: {},
};

describe('state machine transitions', () => {
  it('follows a declared edge', () => {
    expect(reduce(states, 'idle', 'START')).toBe('running');
    expect(reduce(states, 'running', 'FINISH')).toBe('done');
    expect(reduce(states, 'running', 'STOP')).toBe('idle');
  });

  it('ignores an event the current state does not declare', () => {
    // A stray timeout in a terminal state must not resurrect it.
    expect(reduce(states, 'done', 'START')).toBe('done');
    expect(reduce(states, 'done', 'FINISH')).toBe('done');
    // Nor may an out-of-order event skip a state.
    expect(reduce(states, 'idle', 'STOP')).toBe('idle');
    expect(reduce(states, 'idle', 'FINISH')).toBe('idle');
  });

  it('stays put when an event is declared but leads nowhere new', () => {
    expect(reduce(states, 'running', 'START')).toBe('running');
  });

  it('is pure: the same input always yields the same output', () => {
    const first = reduce(states, 'idle', 'START');
    const second = reduce(states, 'idle', 'START');
    expect(first).toBe(second);
    // The table itself is never mutated by a transition.
    expect(states.idle).toEqual({ START: 'running' });
  });
});
