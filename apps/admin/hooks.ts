import { useEffect, useState } from 'react';
import { resolveRoute, allowAdminRoute, type AdminRoute } from './router';
import { subscribeResource, type ResourceState } from './resource';

export function useAdminRoute(): AdminRoute {
  const [route, setRoute] = useState(() => resolveRoute(typeof window === 'undefined' ? '' : window.location.hash));
  useEffect(() => {
    let previous = window.location.hash;
    let asking = false;
    let active = true;
    const changed = () => {
      const destination = window.location.hash;
      if (destination === previous) return;
      if (asking) { window.history.replaceState(null, '', previous || '#rooms'); return; }
      const allowed = allowAdminRoute();
      const navigate = () => { previous = destination; setRoute(resolveRoute(destination)); };
      if (allowed === true) { navigate(); return; }
      window.history.replaceState(null, '', previous || '#rooms');
      asking = true;
      void allowed.then(confirmed => {
        asking = false;
        if (!active || !confirmed) return;
        window.history.pushState(null, '', destination || '#rooms');
        navigate();
      });
    };
    window.addEventListener('hashchange', changed);
    return () => { active = false; window.removeEventListener('hashchange', changed); };
  }, []);
  return route;
}
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, refresh: number, intervalMs = 0) {
  const [state, setState] = useState<ResourceState<T>>({ data: null, error: null, loading: true });
  useEffect(() => subscribeResource(load, setState, intervalMs), [load, refresh, intervalMs]);
  return state;
}
