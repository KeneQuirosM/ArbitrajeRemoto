// Local-first data operations. Every change is saved in IndexedDB immediately
// (works without connection) and queued in the outbox for the sync engine.

import { deriveState } from '../../core/derive.ts';
import type { EventInput, MatchState, Team } from '../../core/types.ts';
import { validateEvent } from '../../core/validate.ts';
import { getDb, type LocalEvent, type LocalMatch, type OutboxItem } from './db.ts';

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to local data changes. Returns the unsubscribe function. */
export function onDataChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyDataChange(): void {
  for (const listener of listeners) listener();
}

export const uuid = (): string => crypto.randomUUID();

export async function getDeviceId(): Promise<string> {
  const db = await getDb();
  const existing = (await db.get('meta', 'deviceId')) as string | undefined;
  if (existing) return existing;
  const id = `web-${uuid()}`;
  await db.put('meta', id, 'deviceId');
  return id;
}

// --- Matches --------------------------------------------------------------

export interface MatchInput {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName: string;
  awayTeamName: string;
  scheduledAt: string | null;
  periods: number;
  periodMinutes: number;
  tournament: string | null;
}

export interface MatchView {
  match: LocalMatch;
  events: LocalEvent[];
  state: MatchState;
}

export async function listMatches(): Promise<MatchView[]> {
  const db = await getDb();
  const [matches, events] = await Promise.all([db.getAll('matches'), db.getAll('events')]);
  const byMatch = new Map<string, LocalEvent[]>();
  for (const e of events) {
    const list = byMatch.get(e.matchId) ?? [];
    list.push(e);
    byMatch.set(e.matchId, list);
  }
  return matches.map((match) => {
    const list = byMatch.get(match.id) ?? [];
    return { match, events: list, state: deriveState(match, list) };
  });
}

export async function getMatchView(id: string): Promise<MatchView | null> {
  const db = await getDb();
  const match = await db.get('matches', id);
  if (!match) return null;
  const events = await db.getAllFromIndex('events', 'byMatch', id);
  return { match, events, state: deriveState(match, events) };
}

export async function createMatch(input: MatchInput): Promise<string> {
  const db = await getDb();
  const deviceId = await getDeviceId();
  const id = uuid();
  const now = new Date().toISOString();
  const match: LocalMatch = { id, ...input, createdAt: now, updatedAt: now, createdByDeviceId: deviceId, liveToken: null, serverLastSeq: 0 };
  const tx = db.transaction(['matches', 'outbox'], 'readwrite');
  await tx.objectStore('matches').put(match);
  // The create body is never changed afterwards: a resent create must be identical to stay idempotent.
  await tx.objectStore('outbox').add({ kind: 'createMatch', matchId: id, body: { id, ...input, deviceId }, createdAt: Date.now() });
  await tx.done;
  notifyDataChange();
  return id;
}

export async function updateMatch(id: string, changes: Partial<MatchInput>): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['matches', 'outbox'], 'readwrite');
  const match = await tx.objectStore('matches').get(id);
  if (!match) throw new Error('Match not found');
  await tx.objectStore('matches').put({ ...match, ...changes, updatedAt: new Date().toISOString() });
  await tx.objectStore('outbox').add({ kind: 'patchMatch', matchId: id, body: { ...changes }, createdAt: Date.now() });
  await tx.done;
  notifyDataChange();
}

export async function deleteMatch(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['matches', 'events', 'outbox'], 'readwrite');
  const outbox = tx.objectStore('outbox');
  let neverSynced = false;
  for (const item of await outbox.getAll()) {
    if ('matchId' in item && item.matchId === id) {
      if (item.kind === 'createMatch') neverSynced = true;
      await outbox.delete(item.id!);
    }
  }
  if (!neverSynced) await outbox.add({ kind: 'deleteMatch', matchId: id, createdAt: Date.now() });
  for (const key of await tx.objectStore('events').index('byMatch').getAllKeys(id)) await tx.objectStore('events').delete(key);
  await tx.objectStore('matches').delete(id);
  await tx.done;
  notifyDataChange();
}

/** Stores a live token the server just issued (not a local edit: nothing to send). */
export async function setLiveToken(id: string, liveToken: string): Promise<void> {
  const db = await getDb();
  const match = await db.get('matches', id);
  if (!match) return;
  await db.put('matches', { ...match, liveToken });
  notifyDataChange();
}

// --- Events ---------------------------------------------------------------

export type NewEvent = Omit<EventInput, 'id' | 'clientTimestamp' | 'deviceId' | 'matchId'>;

/** Records an event now (device time). Throws if the event is invalid. */
export async function addEvent(matchId: string, input: NewEvent, at: Date = new Date()): Promise<LocalEvent> {
  return (await addEvents(matchId, [input], at))[0]!;
}

/** Last timestamp handed out on this device: events from one device never share a millisecond. */
let lastLocalT = 0;

function nextTimestamp(at: Date): Date {
  lastLocalT = Math.max(at.getTime(), lastLocalT + 1);
  return new Date(lastLocalT);
}

export async function addEvents(matchId: string, inputs: NewEvent[], now: Date = new Date()): Promise<LocalEvent[]> {
  const db = await getDb();
  const deviceId = await getDeviceId();
  const created: LocalEvent[] = inputs.map((input) => {
    const at = nextTimestamp(now);
    const parsed = validateEvent({ ...input, id: uuid(), clientTimestamp: at.toISOString(), deviceId });
    if (!parsed.ok) throw new Error(`Invalid event: ${parsed.reason}`);
    const e = parsed.value;
    return {
      ...e,
      matchId,
      deviceId,
      seq: 0,
      createdAt: at.toISOString(),
      clockOffsetMs: 0,
      t: at.getTime(),
      syncStatus: 'pending',
      rejectReason: null,
    };
  });
  const tx = db.transaction(['events', 'outbox'], 'readwrite');
  for (const e of created) {
    await tx.objectStore('events').put(e);
    await tx.objectStore('outbox').add({ kind: 'event', matchId, eventId: e.id, createdAt: Date.now() });
  }
  await tx.done;
  notifyDataChange();
  return created;
}

/** Undo = a new `void` event that cancels the latest effective event. Returns the undone event or null. */
export async function undoLast(matchId: string) {
  const view = await getMatchView(matchId);
  const last = view?.state.timeline.at(-1);
  if (!last) return null;
  await addEvent(matchId, { type: 'void', voidsEventId: last.id });
  return last;
}

/** Reset = void every effective event (history is kept, the board goes back to 0-0 and not started). */
export async function resetMatch(matchId: string): Promise<number> {
  const view = await getMatchView(matchId);
  if (!view || view.state.timeline.length === 0) return 0;
  await addEvents(
    matchId,
    view.state.timeline.map((e) => ({ type: 'void' as const, voidsEventId: e.id })),
  );
  return view.state.timeline.length;
}

// --- Teams ----------------------------------------------------------------

export async function listTeams(): Promise<Team[]> {
  const db = await getDb();
  return (await db.getAll('teams')).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function getTeam(id: string): Promise<Team | undefined> {
  return (await getDb()).get('teams', id);
}

export async function saveTeam(team: Omit<Team, 'createdAt' | 'updatedAt'> & { createdAt?: string }): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(['teams', 'outbox'], 'readwrite');
  const existing = await tx.objectStore('teams').get(team.id);
  await tx.objectStore('teams').put({ ...team, createdAt: existing?.createdAt ?? team.createdAt ?? now, updatedAt: now });
  await removeOutbox(tx.objectStore('outbox'), (item) => item.kind === 'putTeam' && item.teamId === team.id);
  await tx.objectStore('outbox').add({ kind: 'putTeam', teamId: team.id, createdAt: Date.now() });
  await tx.done;
  notifyDataChange();
}

export async function deleteTeam(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['teams', 'outbox'], 'readwrite');
  await tx.objectStore('teams').delete(id);
  await removeOutbox(tx.objectStore('outbox'), (item) => item.kind === 'putTeam' && item.teamId === id);
  await tx.objectStore('outbox').add({ kind: 'deleteTeam', teamId: id, createdAt: Date.now() });
  await tx.done;
  notifyDataChange();
}

// --- Outbox helpers -------------------------------------------------------

type OutboxStore = {
  getAll(): Promise<OutboxItem[]>;
  delete(key: number): Promise<void>;
};

async function removeOutbox(store: OutboxStore, predicate: (item: OutboxItem) => boolean): Promise<void> {
  for (const item of await store.getAll()) if (predicate(item)) await store.delete(item.id!);
}

export async function pendingCount(): Promise<number> {
  return (await getDb()).count('outbox');
}
