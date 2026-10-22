// Local database (IndexedDB). The app always reads and writes here first;
// the outbox holds what still has to reach the API.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Match, StoredEvent, Team } from '../../core/types.ts';

export interface LocalMatch extends Match {
  /** Only known after the match reached the server (owner view). */
  liveToken?: string | null;
  /** Highest server seq already merged locally. */
  serverLastSeq?: number;
  /** Last sync problem for this match (shown to the user). */
  syncError?: string | null;
}

export type EventSyncStatus = 'pending' | 'synced' | 'rejected';

export interface LocalEvent extends StoredEvent {
  syncStatus: EventSyncStatus;
  rejectReason?: string | null;
}

export type OutboxItem =
  | { id?: number; kind: 'createMatch'; matchId: string; body: Record<string, unknown>; createdAt: number }
  | { id?: number; kind: 'patchMatch'; matchId: string; body: Record<string, unknown>; createdAt: number }
  | { id?: number; kind: 'deleteMatch'; matchId: string; createdAt: number }
  | { id?: number; kind: 'event'; matchId: string; eventId: string; createdAt: number }
  | { id?: number; kind: 'putTeam'; teamId: string; createdAt: number }
  | { id?: number; kind: 'deleteTeam'; teamId: string; createdAt: number };

interface Schema extends DBSchema {
  matches: { key: string; value: LocalMatch };
  events: { key: string; value: LocalEvent; indexes: { byMatch: string } };
  teams: { key: string; value: Team };
  outbox: { key: number; value: OutboxItem };
  meta: { key: string; value: unknown };
}

export type DB = IDBPDatabase<Schema>;

export const DB_NAME = 'arbitrajeremoto';

let dbPromise: Promise<DB> | null = null;

export function getDb(): Promise<DB> {
  dbPromise ??= openDB<Schema>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('matches', { keyPath: 'id' });
      db.createObjectStore('events', { keyPath: 'id' }).createIndex('byMatch', 'matchId');
      db.createObjectStore('teams', { keyPath: 'id' });
      db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('meta');
    },
  });
  return dbPromise;
}

/** Tests only: forget the open connection (fake-indexeddb is reset between tests). */
export function resetDbForTests(): void {
  dbPromise = null;
}
