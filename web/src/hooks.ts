// Small Preact hooks: local data that refreshes on change, sync status, ticking clock, hash routing.

import { useCallback, useEffect, useState } from 'preact/hooks';
import { onDataChange } from './repo.ts';
import { getSyncStatus, onSyncStatus, type SyncStatus } from './sync.ts';

/** Loads local data and reloads it whenever local data changes. `undefined` while loading. */
export function useLocalData<T>(loader: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  const load = useCallback(loader, deps);
  useEffect(() => {
    let alive = true;
    const run = () => void load().then((v) => alive && setValue(() => v));
    run();
    const stop = onDataChange(run);
    return () => {
      alive = false;
      stop();
    };
  }, [load]);
  return value;
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState(getSyncStatus());
  useEffect(() => {
    // The status may have changed between the first render and this subscription.
    setStatus(getSyncStatus());
    return onSyncStatus(setStatus);
  }, []);
  return status;
}

/** Current time, refreshed every `intervalMs` while `active`. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

export type Route =
  | { name: 'matches' }
  | { name: 'newMatch' }
  | { name: 'match'; id: string }
  | { name: 'editMatch'; id: string }
  | { name: 'teams' }
  | { name: 'newTeam' }
  | { name: 'team'; id: string }
  | { name: 'settings' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'partidos' && parts[1] === 'nuevo') return { name: 'newMatch' };
  if (parts[0] === 'partidos' && parts[1] && parts[2] === 'editar') return { name: 'editMatch', id: parts[1] };
  if (parts[0] === 'partidos' && parts[1]) return { name: 'match', id: parts[1] };
  if (parts[0] === 'equipos' && parts[1] === 'nuevo') return { name: 'newTeam' };
  if (parts[0] === 'equipos' && parts[1]) return { name: 'team', id: parts[1] };
  if (parts[0] === 'equipos') return { name: 'teams' };
  if (parts[0] === 'ajustes') return { name: 'settings' };
  return { name: 'matches' };
}

export const href = {
  matches: () => '#/',
  newMatch: () => '#/partidos/nuevo',
  match: (id: string) => `#/partidos/${encodeURIComponent(id)}`,
  editMatch: (id: string) => `#/partidos/${encodeURIComponent(id)}/editar`,
  teams: () => '#/equipos',
  newTeam: () => '#/equipos/nuevo',
  team: (id: string) => `#/equipos/${encodeURIComponent(id)}`,
  settings: () => '#/ajustes',
};

export function navigate(target: string): void {
  location.hash = target;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
