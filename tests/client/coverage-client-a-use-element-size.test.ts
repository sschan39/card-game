import { beforeEach, describe, expect, it, vi } from 'vitest';

type EffectCallback = () => void | (() => void);
type StateUpdater = unknown | ((previous: unknown) => unknown);

let effect: EffectCallback | undefined;
let state: unknown;
let refObject: { current: unknown } | undefined;

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (callback: EffectCallback) => { effect = callback; },
    useRef: () => { refObject ??= { current: null }; return refObject; },
    useState: (initial: unknown) => {
      if (state === undefined) state = initial;
      const setState = (next: StateUpdater) => {
        state = typeof next === 'function' ? (next as (previous: unknown) => unknown)(state) : next;
      };
      return [state, setState];
    },
  };
});

const { useElementSize } = await import('@client/hooks/useElementSize');

interface Rect { width: number; height: number }

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: unknown[] = [];
  readonly disconnect = vi.fn();
  constructor(readonly callback: (entries: { contentRect?: Rect }[]) => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: unknown) { this.observed.push(target); }
}

function mount(element: unknown) {
  refObject = { current: element };
  const [ref, size] = useElementSize();
  expect(ref.current).toBe(element);
  return { size, render: () => useElementSize()[1] };
}

beforeEach(() => {
  effect = undefined;
  state = undefined;
  refObject = undefined;
  FakeResizeObserver.instances = [];
  vi.unstubAllGlobals();
});

describe('useElementSize', () => {
  it('starts unmeasured and skips observation without an element or a ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const empty = mount(null);
    expect(empty.size).toEqual({ width: 0, height: 0 });
    effect?.();
    expect(FakeResizeObserver.instances).toHaveLength(0);

    effect = undefined;
    state = undefined;
    refObject = undefined;
    vi.stubGlobal('ResizeObserver', undefined);
    const element = {};
    mount(element);
    expect(() => effect?.()).not.toThrow();
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it('reports the observed content box and ignores sub-pixel or missing updates', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const element = {};
    const size = mount(element);
    const cleanup = effect?.();
    expect(typeof cleanup).toBe('function');

    const observer = FakeResizeObserver.instances[0];
    expect(observer.observed).toEqual([element]);

    observer.callback([{ contentRect: { width: 320, height: 180 } }]);
    expect(size.render()).toEqual({ width: 320, height: 180 });

    const measured = state;
    observer.callback([{ contentRect: { width: 320.5, height: 180.5 } }]);
    expect(state).toBe(measured);

    observer.callback([]);
    expect(state).toBe(measured);

    observer.callback([{ contentRect: { width: 200, height: 90 } }]);
    expect(state).toEqual({ width: 200, height: 90 });

    cleanup?.();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });
});
