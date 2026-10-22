// Sync engine: sends the outbox to the API (safe to retry: everything is idempotent)
// and pulls changes made elsewhere (for example by the watch).

import type { Team } from '../../core/types.ts';
import { api, ApiFailure, NetworkError } from './api.ts';
import { getDb, type LocalEvent, type LocalMatch, type OutboxItem } from './db.ts';
import { getDeviceId, notifyDataChange, onDataChange } from './repo.ts';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'needsLogin' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  pending: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

const EVENT_BATCH = 200;
let status: SyncStatus = { phase: 'idle', pending: 0, lastSyncAt: null, lastError: null };
const statusListeners = new Set<(s: SyncStatus) => void>();

export function getSyncStatus(): SyncStatus {
  return status;
}

export function onSyncStatus(listener: (s: SyncStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of statusListeners) listener(status);
}

class NeedsLogin extends Error {}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

// --- Session --------------------------------------------------------------

export async function login(passphrase: string): Promise<void> {
  await api('POST', '/session', { passphrase });
  void syncNow();
}

export async function logout(): Promise<void> {
  await api('DELETE', '/session');
  setStatus({ phase: 'needsLogin' });
}

export async function isLoggedIn(): Promise<boolean> {
  const { data } = await api<{ authenticated: boolean; role?: string }>('GET', '/session');
  return data.authenticated && data.role === 'owner';
}

// --- Main entry -------------------------------------------------------------

let running: Promise<SyncStatus> | null = null;
let notifyingFromSync = false;
let runAgain = false;

/** Runs one full sync (push then pull). Concurrent calls share the same run. */
export function syncNow(): Promise<SyncStatus> {
  if (running) {
    // Changes made during a run are sent by one more run right after it.
    runAgain = true;
    return running;
  }
  running = runSync().finally(() => {
    running = null;
    if (runAgain) {
      runAgain = false;
      void syncNow();
    }
  });
  return running;
}

async function runSync(): Promise<SyncStatus> {
  await refreshPending();
  if (!isOnline()) {
    setStatus({ phase: 'offline' });
    return status;
  }
  setStatus({ phase: 'syncing' });
  try {
    if (!(await isLoggedIn())) throw new NeedsLogin();
    await pushOutbox();
    await pull();
    setStatus({ phase: 'idle', lastSyncAt: Date.now(), lastError: null });
  } catch (error) {
    if (error instanceof NeedsLogin || (error instanceof ApiFailure && error.status === 401)) setStatus({ phase: 'needsLogin' });
    else if (error instanceof NetworkError) setStatus({ phase: 'offline' });
    else setStatus({ phase: 'error', lastError: error instanceof Error ? error.message : String(error) });
  }
  await refreshPending();
  // Our own writes must not schedule another sync (that would loop forever).
  notifyingFromSync = true;
  try {
    notifyDataChange();
  } finally {
    notifyingFromSync = false;
  }
  return status;
}

async function refreshPending(): Promise<void> {
  setStatus({ pending: await (await getDb()).count('outbox') });
}

/** Errors that will not go away by retrying the same request. */
const isPermanent = (error: unknown) =>
  error instanceof ApiFailure && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 408 && error.status !== 429;

// --- Push -------------------------------------------------------------------

async function pushOutbox(): Promise<void> {
  const db = await getDb();
  const items = (await db.getAll('outbox')).sort((a, b) => a.id! - b.id!);
  const blocked = new Set<string>();

  for (const item of items) {
    if (item.kind === 'putTeam' || item.kind === 'deleteTeam') await pushTeam(item);
  }
  for (const item of items) {
    if (item.kind === 'createMatch' || item.kind === 'patchMatch' || item.kind === 'deleteMatch') {
      if (blocked.has(item.matchId)) continue;
      const ok = await pushMatch(item);
      if (!ok) blocked.add(item.matchId);
    }
  }
  const byMatch = new Map<string, Extract<OutboxItem, { kind: 'event' }>[]>();
  for (const item of items) {
    if (item.kind !== 'event' || blocked.has(item.matchId)) continue;
    const list = byMatch.get(item.matchId) ?? [];
    list.push(item);
    byMatch.set(item.matchId, list);
  }
  for (const [matchId, list] of byMatch) {
    for (let i = 0; i < list.length; i += EVENT_BATCH) await pushEvents(matchId, list.slice(i, i + EVENT_BATCH));
  }
}

async function pushTeam(item: Extract<OutboxItem, { kind: 'putTeam' | 'deleteTeam' }>): Promise<void> {
  const db = await getDb();
  try {
    if (item.kind === 'putTeam') {
      const team = await db.get('teams', item.teamId);
      if (team) await api('PUT', `/teams/${team.id}`, { name: team.name, players: team.players });
    } else {
      await api('DELETE', `/teams/${item.teamId}`);
    }
  } catch (error) {
    const gone = error instanceof ApiFailure && error.status === 404 && item.kind === 'deleteTeam';
    if (!gone && !isPermanent(error)) throw error;
  }
  await db.delete('outbox', item.id!);
}

/** Returns false when later items of this match must wait or be dropped. */
async function pushMatch(item: Extract<OutboxItem, { kind: 'createMatch' | 'patchMatch' | 'deleteMatch' }>): Promise<boolean> {
  const db = await getDb();
  try {
    if (item.kind === 'createMatch') {
      const { data } = await api<{ match: LocalMatch & { liveToken: string } }>('POST', '/matches', item.body);
      await updateLocalMatch(item.matchId, { liveToken: data.match.liveToken, syncError: null });
    } else if (item.kind === 'patchMatch') {
      await api('PATCH', `/matches/${item.matchId}`, item.body);
    } else {
      await api('DELETE', `/matches/${item.matchId}`);
    }
  } catch (error) {
    if (item.kind === 'deleteMatch' && error instanceof ApiFailure && error.status === 404) {
      await db.delete('outbox', item.id!);
      return true;
    }
    if (!isPermanent(error)) throw error;
    await db.delete('outbox', item.id!);
    await updateLocalMatch(item.matchId, { syncError: (error as ApiFailure).code });
    return item.kind !== 'createMatch';
  }
  await db.delete('outbox', item.id!);
  return true;
}

async function updateLocalMatch(id: string, patch: Partial<LocalMatch>): Promise<void> {
  const db = await getDb();
  const match = await db.get('matches', id);
  if (match) await db.put('matches', { ...match, ...patch });
}

/** Fields the API accepts for an event (the server adds seq, t, etc.). */
function eventPayload(e: LocalEvent) {
  return {
    id: e.id,
    type: e.type,
    team: e.team,
    playerNumber: e.playerNumber,
    playerOutNumber: e.playerOutNumber,
    playerInNumber: e.playerInNumber,
    text: e.text,
    voidsEventId: e.voidsEventId,
    period: e.period,
    minutes: e.minutes,
    clientTimestamp: e.clientTimestamp,
    matchMinute: e.matchMinute,
    deviceId: e.deviceId,
  };
}

async function pushEvents(matchId: string, items: Extract<OutboxItem, { kind: 'event' }>[]): Promise<void> {
  const db = await getDb();
  const events: LocalEvent[] = [];
  for (const item of items) {
    const e = await db.get('events', item.eventId);
    if (e) events.push(e);
    else await db.delete('outbox', item.id!);
  }
  if (events.length === 0) return;

  let results: { id: string | null; status: string; reason?: string }[];
  try {
    const { data } = await api<{ results: typeof results }>('POST', `/matches/${matchId}/events`, {
      deviceId: await getDeviceId(),
      sentAt: new Date().toISOString(),
      events: events.map(eventPayload),
    });
    results = data.results;
  } catch (error) {
    if (error instanceof ApiFailure && (error.status === 404 || error.status === 410)) {
      // The match does not exist on the server (deleted elsewhere): keep the events locally, stop sending them.
      await updateLocalMatch(matchId, { syncError: error.code });
      for (const item of items) await db.delete('outbox', item.id!);
      return;
    }
    throw error;
  }

  const tx = db.transaction(['events', 'outbox'], 'readwrite');
  for (const [index, e] of events.entries()) {
    const result = results[index];
    if (!result) continue;
    const rejected = result.status === 'rejected';
    await tx.objectStore('events').put({ ...e, syncStatus: rejected ? 'rejected' : 'synced', rejectReason: rejected ? (result.reason ?? null) : null });
  }
  for (const item of items) await tx.objectStore('outbox').delete(item.id!);
  await tx.done;
}

// --- Pull -------------------------------------------------------------------

interface ServerSummary {
  id: string;
  updatedAt: string;
  lastSeq: number;
}

async function pull(): Promise<void> {
  const db = await getDb();
  const outbox = await db.getAll('outbox');
  const pendingTeams = new Set(outbox.flatMap((i) => ('teamId' in i ? [i.teamId] : [])));
  const pendingMatches = new Set(outbox.flatMap((i) => ('matchId' in i && i.kind !== 'event' ? [i.matchId] : [])));

  const { data: teamData } = await api<{ teams: Team[] }>('GET', '/teams');
  const serverTeamIds = new Set(teamData.teams.map((t) => t.id));
  for (const team of teamData.teams) if (!pendingTeams.has(team.id)) await db.put('teams', team);
  for (const local of await db.getAll('teams')) {
    if (!serverTeamIds.has(local.id) && !pendingTeams.has(local.id)) await db.delete('teams', local.id);
  }

  const { data: list } = await api<{ matches: ServerSummary[] }>('GET', '/matches?fields=updatedAt,lastSeq');
  const serverIds = new Set(list.matches.map((m) => m.id));
  for (const summary of list.matches) {
    const local = await db.get('matches', summary.id);
    const changed = !local || summary.lastSeq > (local.serverLastSeq ?? 0) || summary.updatedAt !== local.updatedAt || !local.liveToken;
    if (changed) await pullMatch(summary.id, pendingMatches.has(summary.id));
  }
  // Matches the server no longer has: drop the ones it had before (known by their liveToken).
  for (const local of await db.getAll('matches')) {
    if (!serverIds.has(local.id) && local.liveToken && !pendingMatches.has(local.id)) {
      const tx = db.transaction(['matches', 'events'], 'readwrite');
      for (const key of await tx.objectStore('events').index('byMatch').getAllKeys(local.id)) await tx.objectStore('events').delete(key);
      await tx.objectStore('matches').delete(local.id);
      await tx.done;
    }
  }
}

async function pullMatch(id: string, hasPendingChanges: boolean): Promise<void> {
  const db = await getDb();
  const { data } = await api<{ match: LocalMatch & { liveToken: string }; events: LocalEvent[]; state: { lastSeq: number } }>(
    'GET',
    `/matches/${id}?include=events`,
  );
  const tx = db.transaction(['matches', 'events', 'outbox'], 'readwrite');
  const local = await tx.objectStore('matches').get(id);
  const merged: LocalMatch = hasPendingChanges && local
    ? { ...local, liveToken: data.match.liveToken, serverLastSeq: data.state.lastSeq }
    : { ...data.match, serverLastSeq: data.state.lastSeq, syncError: local?.syncError ?? null };
  await tx.objectStore('matches').put(merged);
  const serverEventIds = new Set<string>();
  for (const e of data.events) {
    serverEventIds.add(e.id);
    await tx.objectStore('events').put({ ...e, syncStatus: 'synced', rejectReason: null });
  }
  // Pending copies the server already has (e.g. the response to our POST was lost) no longer need sending.
  for (const item of await tx.objectStore('outbox').getAll()) {
    if (item.kind === 'event' && serverEventIds.has(item.eventId)) await tx.objectStore('outbox').delete(item.id!);
  }
  await tx.done;
}

// --- Automatic sync ---------------------------------------------------------

/** Syncs on start, when the connection returns, when the app is shown, after local changes and every 30 s. */
export function startAutoSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const soon = (delay = 1500) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), delay);
  };
  const onOnline = () => soon(300);
  const onOffline = () => setStatus({ phase: 'offline' });
  const onVisible = () => document.visibilityState === 'visible' && soon(300);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  const stopData = onDataChange(() => {
    void refreshPending();
    if (!notifyingFromSync) soon();
  });
  const interval = setInterval(() => soon(0), 30_000);
  soon(0);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
    stopData();
    clearInterval(interval);
    if (timer) clearTimeout(timer);
  };
}
