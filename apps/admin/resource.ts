export interface ResourceState<T> { data: T | null; error: string | null; loading: boolean }
/** One active request at a time; disposal prevents late results and cancels future polling. */
export function subscribeResource<T>(load: (signal: AbortSignal) => Promise<T>, changed: (state: ResourceState<T>) => void, intervalMs = 0): () => void {
  const controller = new AbortController();
  let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined, data: T | null = null;
  changed({ data, error: null, loading: true });
  const update = async () => {
    try { const value = await load(controller.signal); if (!cancelled) { data = value; changed({ data, error: null, loading: false }); } }
    catch (error) { if (!cancelled) changed({ data, error: error instanceof Error ? error.message : 'Unable to load this page.', loading: false }); }
    if (!cancelled && intervalMs) timer = setTimeout(() => void update(), intervalMs);
  };
  void update();
  return () => { cancelled = true; controller.abort(); if (timer) clearTimeout(timer); };
}
