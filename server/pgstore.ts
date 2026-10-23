// KVStore implemented on Postgres (Supabase). Each key family maps to its own table
// (see supabase/migrations). ETags are the rows' `version` numbers, so the optimistic
// concurrency of server/store.ts `update()` works exactly as with the other stores.
//
//   matches/{id}            -> arbitraje.matches + arbitraje.events (append-only)
//   index/matches           -> arbitraje.matches.summary, versioned by arbitraje.meta('index')
//   teams                   -> arbitraje.teams rows, versioned by arbitraje.meta('teams')
//   devices/{keyId}         -> arbitraje.devices
//   pairing/{code}          -> arbitraje.pairing_codes
//   ratelimit/{bucket}/{h}  -> arbitraje.rate_limits

import type postgres from 'postgres';
import type { StoredEvent, Team } from '../core/types.ts';
import type { Sql } from './db.ts';
import type { MatchDoc, MatchSummary } from './matches.ts';
import type { Doc, KVStore, WriteOptions } from './store.ts';

type Tx = Sql | postgres.TransactionSql;

type Key =
  | { kind: 'match'; id: string }
  | { kind: 'index' }
  | { kind: 'teams' }
  | { kind: 'device'; keyId: string }
  | { kind: 'pairing'; code: string }
  | { kind: 'ratelimit'; bucket: string; hash: string };

function parseKey(key: string): Key {
  const parts = key.split('/');
  if (parts[0] === 'matches' && parts.length === 2) return { kind: 'match', id: parts[1]! };
  if (key === 'index/matches') return { kind: 'index' };
  if (key === 'teams') return { kind: 'teams' };
  if (parts[0] === 'devices' && parts.length === 2) return { kind: 'device', keyId: parts[1]! };
  if (parts[0] === 'pairing' && parts.length === 2) return { kind: 'pairing', code: parts[1]! };
  if (parts[0] === 'ratelimit' && parts.length === 3) return { kind: 'ratelimit', bucket: parts[1]!, hash: parts[2]! };
  throw new Error(`PostgresStore: unsupported key ${key}`);
}

const iso = (value: string | Date | null): string | null => (value === null ? null : new Date(value).toISOString());

interface EventRow {
  id: string;
  seq: number;
  type: StoredEvent['type'];
  team: StoredEvent['team'];
  player_number: number | null;
  player_out_number: number | null;
  player_in_number: number | null;
  text: string | null;
  voids_event_id: string | null;
  period: number | null;
  minutes: number | null;
  client_timestamp: string;
  match_minute: number | null;
  device_id: string;
  created_at: string;
  clock_offset_ms: number | string;
  t: number | string;
}

function eventFromRow(row: EventRow, matchId: string): StoredEvent {
  return {
    id: row.id,
    matchId,
    type: row.type,
    team: row.team,
    playerNumber: row.player_number,
    playerOutNumber: row.player_out_number,
    playerInNumber: row.player_in_number,
    text: row.text,
    voidsEventId: row.voids_event_id,
    period: row.period,
    minutes: row.minutes,
    clientTimestamp: iso(row.client_timestamp)!,
    matchMinute: row.match_minute,
    deviceId: row.device_id,
    seq: row.seq,
    createdAt: iso(row.created_at)!,
    clockOffsetMs: Number(row.clock_offset_ms),
    t: Number(row.t),
  };
}

export class PostgresStore implements KVStore {
  private readonly sql: Sql;
  /** Test hook: runs right before each conditional write (to simulate a concurrent writer). */
  beforeWrite: ((key: string) => Promise<void> | void) | null = null;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  async get<T>(key: string): Promise<Doc<T> | null> {
    const k = parseKey(key);
    const doc = await this.read(this.sql, k);
    return doc as Doc<T> | null;
  }

  async set(key: string, value: unknown, options: WriteOptions = {}): Promise<boolean> {
    if (this.beforeWrite && (options.onlyIfMatch || options.onlyIfNew)) {
      const hook = this.beforeWrite;
      this.beforeWrite = null;
      await hook(key);
    }
    const k = parseKey(key);
    // ETags here are row versions; anything else can never match.
    if (options.onlyIfMatch !== undefined && !/^\d+$/.test(options.onlyIfMatch)) return false;
    return this.sql.begin(async (tx) => this.write(tx, k, value, options)) as Promise<boolean>;
  }

  async delete(key: string): Promise<void> {
    const k = parseKey(key);
    const sql = this.sql;
    switch (k.kind) {
      case 'match':
        await sql`delete from arbitraje.matches where id = ${k.id}`;
        return;
      case 'device':
        await sql`delete from arbitraje.devices where key_id = ${k.keyId}`;
        return;
      case 'pairing':
        await sql`delete from arbitraje.pairing_codes where code = ${k.code}`;
        return;
      case 'ratelimit':
        await sql`delete from arbitraje.rate_limits where bucket = ${k.bucket} and client_hash = ${k.hash}`;
        return;
      case 'teams':
        await sql.begin(async (tx) => {
          await tx`delete from arbitraje.teams`;
          await tx`delete from arbitraje.meta where key = 'teams'`;
        });
        return;
      case 'index':
        await sql.begin(async (tx) => {
          await tx`update arbitraje.matches set summary = null where summary is not null`;
          await tx`delete from arbitraje.meta where key = 'index'`;
        });
        return;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const sql = this.sql;
    const keys: string[] = [];
    if ('matches/'.startsWith(prefix) || prefix.startsWith('matches/')) {
      for (const r of await sql<{ id: string }[]>`select id from arbitraje.matches`) keys.push(`matches/${r.id}`);
    }
    if ('devices/'.startsWith(prefix) || prefix.startsWith('devices/')) {
      for (const r of await sql<{ key_id: string }[]>`select key_id from arbitraje.devices`) keys.push(`devices/${r.key_id}`);
    }
    if ('pairing/'.startsWith(prefix) || prefix.startsWith('pairing/')) {
      for (const r of await sql<{ code: string }[]>`select code from arbitraje.pairing_codes`) keys.push(`pairing/${r.code}`);
    }
    if ('ratelimit/'.startsWith(prefix) || prefix.startsWith('ratelimit/')) {
      for (const r of await sql<{ bucket: string; client_hash: string }[]>`select bucket, client_hash from arbitraje.rate_limits`) {
        keys.push(`ratelimit/${r.bucket}/${r.client_hash}`);
      }
    }
    if ('teams'.startsWith(prefix) && (await sql`select 1 from arbitraje.meta where key = 'teams'`).length) keys.push('teams');
    if ('index/matches'.startsWith(prefix) && (await sql`select 1 from arbitraje.meta where key = 'index'`).length) {
      keys.push('index/matches');
    }
    return keys.filter((key) => key.startsWith(prefix)).sort();
  }

  // --- Reads -------------------------------------------------------------------

  private async read(sql: Tx, k: Key): Promise<Doc<unknown> | null> {
    switch (k.kind) {
      case 'match': {
        const [row] = await sql<
          {
            data: MatchDoc['match'];
            live_token: string;
            creation_fingerprint: string;
            last_seq: number;
            deleted_at: Date | null;
            version: string;
          }[]
        >`select data, live_token, creation_fingerprint, last_seq, deleted_at, version from arbitraje.matches where id = ${k.id}`;
        if (!row) return null;
        const rows = await sql<EventRow[]>`select * from arbitraje.events where match_id = ${k.id} order by seq`;
        const doc: MatchDoc = {
          match: row.data,
          liveToken: row.live_token,
          creationFingerprint: row.creation_fingerprint,
          events: rows.map((r) => eventFromRow(r, k.id)),
          lastSeq: row.last_seq,
          deletedAt: iso(row.deleted_at),
        };
        return { data: doc, etag: String(row.version) };
      }
      case 'index': {
        const [meta] = await sql<{ version: string }[]>`select version from arbitraje.meta where key = 'index'`;
        if (!meta) return null;
        const rows = await sql<{ summary: MatchSummary }[]>`select summary from arbitraje.matches where summary is not null order by id`;
        return { data: { items: rows.map((r) => r.summary) }, etag: String(meta.version) };
      }
      case 'teams': {
        const [meta] = await sql<{ version: string }[]>`select version from arbitraje.meta where key = 'teams'`;
        if (!meta) return null;
        const rows = await sql<{ id: string; name: string; players: Team['players']; created_at: Date; updated_at: Date }[]>`
          select id, name, players, created_at, updated_at from arbitraje.teams order by created_at, id`;
        const teams: Team[] = rows.map((r) => ({
          id: r.id,
          name: r.name,
          players: r.players,
          createdAt: iso(r.created_at)!,
          updatedAt: iso(r.updated_at)!,
        }));
        return { data: { teams }, etag: String(meta.version) };
      }
      case 'device': {
        const [row] = await sql<{ data: unknown; version: string }[]>`select data, version from arbitraje.devices where key_id = ${k.keyId}`;
        return row ? { data: row.data, etag: String(row.version) } : null;
      }
      case 'pairing': {
        const [row] = await sql<{ data: unknown; version: string }[]>`select data, version from arbitraje.pairing_codes where code = ${k.code}`;
        return row ? { data: row.data, etag: String(row.version) } : null;
      }
      case 'ratelimit': {
        const [row] = await sql<{ data: unknown; version: string }[]>`
          select data, version from arbitraje.rate_limits where bucket = ${k.bucket} and client_hash = ${k.hash}`;
        return row ? { data: row.data, etag: String(row.version) } : null;
      }
    }
  }

  // --- Writes (always inside a transaction) -------------------------------------

  private async write(tx: postgres.TransactionSql, k: Key, value: unknown, options: WriteOptions): Promise<boolean> {
    switch (k.kind) {
      case 'match':
        return this.writeMatch(tx, k.id, value as MatchDoc, options);
      case 'index':
        return this.writeIndex(tx, (value as { items: MatchSummary[] }).items, options);
      case 'teams':
        return this.writeTeams(tx, (value as { teams: Team[] }).teams, options);
      case 'device': {
        const d = value as { deviceId: string; revokedAt: string | null };
        return this.writeRow(options, {
          insert: () => tx`
            insert into arbitraje.devices (key_id, device_id, data, revoked_at)
            values (${k.keyId}, ${d.deviceId}, ${json(tx, value)}, ${d.revokedAt})
            on conflict (key_id) do nothing returning 1`,
          update: (version) => tx`
            update arbitraje.devices set device_id = ${d.deviceId}, data = ${json(tx, value)}, revoked_at = ${d.revokedAt},
              version = version + 1
            where key_id = ${k.keyId} and (${version}::bigint is null or version = ${version}::bigint) returning 1`,
        });
      }
      case 'pairing': {
        const p = value as { expiresAt: string };
        return this.writeRow(options, {
          insert: () => tx`
            insert into arbitraje.pairing_codes (code, data, expires_at)
            values (${k.code}, ${json(tx, value)}, ${p.expiresAt})
            on conflict (code) do nothing returning 1`,
          update: (version) => tx`
            update arbitraje.pairing_codes set data = ${json(tx, value)}, expires_at = ${p.expiresAt}, version = version + 1
            where code = ${k.code} and (${version}::bigint is null or version = ${version}::bigint) returning 1`,
        });
      }
      case 'ratelimit':
        return this.writeRow(options, {
          insert: () => tx`
            insert into arbitraje.rate_limits (bucket, client_hash, data)
            values (${k.bucket}, ${k.hash}, ${json(tx, value)})
            on conflict (bucket, client_hash) do nothing returning 1`,
          update: (version) => tx`
            update arbitraje.rate_limits set data = ${json(tx, value)}, version = version + 1
            where bucket = ${k.bucket} and client_hash = ${k.hash}
              and (${version}::bigint is null or version = ${version}::bigint) returning 1`,
        });
    }
  }

  /** Single-row documents: insert-if-new, update-if-version-matches, or upsert. */
  private async writeRow(
    options: WriteOptions,
    q: { insert: () => PromiseLike<readonly unknown[]>; update: (version: string | null) => PromiseLike<readonly unknown[]> },
  ): Promise<boolean> {
    if (options.onlyIfNew) return (await q.insert()).length === 1;
    if (options.onlyIfMatch) return (await q.update(options.onlyIfMatch)).length === 1;
    if ((await q.update(null)).length === 1) return true;
    return (await q.insert()).length === 1;
  }

  /** Bumps (or creates) a meta version row; false when the expected version is not current. */
  private async bumpMeta(tx: postgres.TransactionSql, key: string, options: WriteOptions): Promise<boolean> {
    if (options.onlyIfNew) {
      return (await tx`insert into arbitraje.meta (key) values (${key}) on conflict (key) do nothing returning 1`).length === 1;
    }
    if (options.onlyIfMatch) {
      return (
        await tx`update arbitraje.meta set version = version + 1 where key = ${key} and version = ${options.onlyIfMatch}::bigint returning 1`
      ).length === 1;
    }
    await tx`insert into arbitraje.meta (key) values (${key}) on conflict (key) do update set version = arbitraje.meta.version + 1`;
    return true;
  }

  private async writeMatch(tx: postgres.TransactionSql, id: string, doc: MatchDoc, options: WriteOptions): Promise<boolean> {
    let previousLastSeq = 0;
    if (options.onlyIfNew) {
      const inserted = await tx`
        insert into arbitraje.matches (id, data, live_token, creation_fingerprint, last_seq, deleted_at)
        values (${id}, ${json(tx, doc.match)}, ${doc.liveToken}, ${doc.creationFingerprint}, ${doc.lastSeq}, ${doc.deletedAt})
        on conflict (id) do nothing returning 1`;
      if (inserted.length === 0) return false;
    } else {
      const [current] = await tx<{ version: string; last_seq: number }[]>`
        select version, last_seq from arbitraje.matches where id = ${id} for update`;
      if (options.onlyIfMatch && current?.version !== options.onlyIfMatch) return false;
      if (current) {
        previousLastSeq = current.last_seq;
        await tx`
          update arbitraje.matches set data = ${json(tx, doc.match)}, live_token = ${doc.liveToken},
            creation_fingerprint = ${doc.creationFingerprint}, last_seq = ${doc.lastSeq}, deleted_at = ${doc.deletedAt},
            version = version + 1
          where id = ${id}`;
      } else {
        await tx`
          insert into arbitraje.matches (id, data, live_token, creation_fingerprint, last_seq, deleted_at)
          values (${id}, ${json(tx, doc.match)}, ${doc.liveToken}, ${doc.creationFingerprint}, ${doc.lastSeq}, ${doc.deletedAt})`;
      }
    }

    if (doc.deletedAt && doc.events.length === 0) {
      // Tombstone: the match row stays (so a resent create gets 410), its events go.
      await tx`delete from arbitraje.events where match_id = ${id}`;
      return true;
    }
    // Events are append-only: only those newer than what this row already had are new.
    // ON CONFLICT DO NOTHING keeps a resent event from ever being stored twice.
    const fresh = doc.events.filter((e) => e.seq > previousLastSeq);
    if (fresh.length > 0) {
      await tx`
        insert into arbitraje.events (match_id, id, seq, type, team, player_number, player_out_number, player_in_number,
          text, voids_event_id, period, minutes, client_timestamp, match_minute, device_id, created_at, clock_offset_ms, t)
        select ${id}::uuid, x.id, x.seq, x.type, x.team, x."playerNumber", x."playerOutNumber", x."playerInNumber",
          x.text, x."voidsEventId", x.period, x.minutes, x."clientTimestamp", x."matchMinute", x."deviceId",
          x."createdAt", x."clockOffsetMs", x.t
        from jsonb_to_recordset(${json(tx, fresh)}) as x(
          id uuid, seq integer, type text, team text, "playerNumber" smallint, "playerOutNumber" smallint,
          "playerInNumber" smallint, text text, "voidsEventId" uuid, period smallint, minutes smallint,
          "clientTimestamp" timestamptz, "matchMinute" smallint, "deviceId" text, "createdAt" timestamptz,
          "clockOffsetMs" bigint, t bigint)
        on conflict (match_id, id) do nothing`;
    }
    return true;
  }

  private async writeIndex(tx: postgres.TransactionSql, items: MatchSummary[], options: WriteOptions): Promise<boolean> {
    if (!(await this.bumpMeta(tx, 'index', options))) return false;
    const ids = items.map((item) => item.id);
    await tx`update arbitraje.matches set summary = null where summary is not null and not (id = any(${ids}::uuid[]))`;
    if (items.length > 0) {
      await tx`
        update arbitraje.matches m set summary = x.item
        from jsonb_array_elements(${json(tx, items)}) as x(item)
        where m.id = (x.item ->> 'id')::uuid`;
    }
    return true;
  }

  private async writeTeams(tx: postgres.TransactionSql, teams: Team[], options: WriteOptions): Promise<boolean> {
    if (!(await this.bumpMeta(tx, 'teams', options))) return false;
    const ids = teams.map((team) => team.id);
    await tx`delete from arbitraje.teams where not (id = any(${ids}::uuid[]))`;
    for (const team of teams) {
      await tx`
        insert into arbitraje.teams (id, name, players, created_at, updated_at)
        values (${team.id}, ${team.name}, ${json(tx, team.players)}, ${team.createdAt}, ${team.updatedAt})
        on conflict (id) do update set name = excluded.name, players = excluded.players,
          created_at = excluded.created_at, updated_at = excluded.updated_at`;
    }
    return true;
  }
}

/** JSON parameter (jsonb). */
function json(tx: Tx, value: unknown) {
  return tx.json(value as postgres.JSONValue);
}
