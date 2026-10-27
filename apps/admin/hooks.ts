import { useEffect, useState } from 'react';
import { resolveRoute, type AdminRoute } from './router';
import { subscribeResource, type ResourceState } from './resource';

export function useAdminRoute(): AdminRoute {
  const [route, setRoute] = useState(() => resolveRoute(typeof window === 'undefined' ? '' : window.location.hash));
  useEffect(() => { const changed = () => setRoute(resolveRoute(window.location.hash)); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  return route;
}
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, refresh: number, intervalMs = 0) {
  const [state, setState] = useState<ResourceState<T>>({ data: null, error: null, loading: true });
  useEffect(() => subscribeResource(load, setState, intervalMs), [load, refresh, intervalMs]);
  return state;
}
