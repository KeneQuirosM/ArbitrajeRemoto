// Postgres layer: KV contract (shared with MemoryStore), append-only events with
// ON CONFLICT DO NOTHING, ordering by server seq, tombstones, migrations and RLS.
// The Postgres part runs when TEST_DATABASE_URL is set (always in CI).

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from '../server/db.ts';
import { PostgresStore } from '../server/pgstore.ts';
import { MemoryStore, update, type KVStore } from '../server/store.ts';
import { MIN, T0, iso, makeApi } from './helpers.ts';
import { PG_URL, freshDatabase } from './pg.ts';
import { createApp } from '../server/app.ts';
import { hashPassphrase } from '../server/crypto.ts';

const MIGRATION = readFileSync(new URL('../supabase/migrations/20261023120000_init.sql', import.meta.url), 'utf8');

function storeContract(name: string, makeStore: () => Promise<KVStore>) {
  describe(`KV contract: ${name}`, () => {
    it('conditional writes follow ETags', async () => {
      const store = await makeStore();
      const key = 'devices/0123456789abcdef';
      const record = { keyId: '0123456789abcdef', deviceId: 'w1', revokedAt: null };
      expect(await store.get(key)).toBeNull();
      expect(await store.set(key, record, { onlyIfNew: true })).toBe(true);
      expect(await store.set(key, record, { onlyIfNew: true })).toBe(false);
      const first = (await store.get<typeof record>(key))!;
      expect(first.data).toEqual(record);
      expect(await store.set(key, { ...record, deviceId: 'w2' }, { onlyIfMatch: first.etag })).toBe(true);
      expect(await store.set(key, { ...record, deviceId: 'w3' }, { onlyIfMatch: first.etag })).toBe(false);
      const second = (await store.get<typeof record>(key))!;
      expect(second.data.deviceId).toBe('w2');
      expect(second.etag).not.toBe(first.etag);
      expect(await store.list('devices/')).toEqual([key]);
      await store.delete(key);
      expect(await store.get(key)).toBeNull();
    });

    it('update() retries until it wins', async () => {
      const store = await makeStore();
      const key = 'ratelimit/login/abc';
      await Promise.all(
        Array.from({ length: 5 }, () =>
          update<{ count: number }>(store, key, (c) => ({ count: (c?.count ?? 0) + 1 })),
        ),
      );
      expect((await store.get<{ count: number }>(key))!.data.count).toBe(5);
    });

    it('stores the team list and the match index as versioned documents', async () => {
      const store = await makeStore();
      const now = new Date(T0).toISOString();
      const team = { id: randomUUID(), name: 'Halcones', players: [{ id: randomUUID(), number: 9, name: null }], createdAt: now, updatedAt: now };
      expect(await store.set('teams', { teams: [team] }, { onlyIfNew: true })).toBe(true);
      const teams = (await store.get<{ teams: unknown[] }>('teams'))!;
      expect(teams.data.teams).toEqual([team]);
      expect(await store.set('teams', { teams: [] }, { onlyIfMatch: 'stale' })).toBe(false);
      expect(await store.set('teams', { teams: [] }, { onlyIfMatch: teams.etag })).toBe(true);
      expect((await store.get<{ teams: unknown[] }>('teams'))!.data.teams).toEqual([]);
    });
  });
}

storeContract('MemoryStore', async () => new MemoryStore());

describe.skipIf(!PG_URL)('Postgres', () => {
  let sql: Sql;
  beforeAll(async () => {
    sql = (await freshDatabase()).sql;
  });

  storeContract('PostgresStore', async () => new PostgresStore((await freshDatabase()).sql));

  async function apiOnDb() {
    const db = await freshDatabase();
    const store = new PostgresStore(db.sql);
    const app = createApp({
      store,
      env: { ADMIN_PASSPHRASE_HASH: HASH, SESSION_SECRET: 's'.repeat(40) },
      now: () => T0 + 60 * MIN,
      uuid: randomUUID,
      secureCookies: true,
    });
    let cookie = '';
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.handle(
        new Request(`https://x.test/api/v1${path}`, {
          method,
          headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        '127.0.0.1',
      );
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0]!;
      return { status: res.status, body: res.status === 204 ? null : await res.json() };
    };
    await call('POST', '/session', { passphrase: 'frase de prueba larga' });
    return { sql: db.sql, call };
  }
  const HASH = hashPassphrase('frase de prueba larga');

  it('stores each event once however many times the batch is sent, ordered by server seq', async () => {
    const { sql: db, call } = await apiOnDb();
    const id = randomUUID();
    await call('POST', '/matches', { id, deviceId: 'web-1' });
    const events = [
      { id: randomUUID(), type: 'period_start', period: 1, clientTimestamp: iso(T0) },
      { id: randomUUID(), type: 'goal', team: 'home', playerNumber: 9, clientTimestamp: iso(T0 + 5 * MIN) },
      { id: randomUUID(), type: 'note', text: 'Lluvia', clientTimestamp: iso(T0 + 6 * MIN) },
    ];
    for (let i = 0; i < 3; i++) {
      const res = await call('POST', `/matches/${id}/events`, { deviceId: 'web-1', events: [...events].reverse() });
      expect(res.status).toBe(200);
    }
    const rows = await db<{ id: string; seq: number }[]>`select id, seq from arbitraje.events where match_id = ${id} order by seq`;
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.id)).toEqual([...events].reverse().map((e) => e.id));
    const [m] = await db<{ last_seq: number }[]>`select last_seq from arbitraje.matches where id = ${id}`;
    expect(m!.last_seq).toBe(3);
  });

  it('rejects a reused id with different content and keeps the original row', async () => {
    const { sql: db, call } = await apiOnDb();
    const id = randomUUID();
    await call('POST', '/matches', { id, deviceId: 'web-1' });
    const eventId = randomUUID();
    await call('POST', `/matches/${id}/events`, { deviceId: 'web-1', events: [{ id: eventId, type: 'goal', team: 'home', clientTimestamp: iso(T0) }] });
    const res = await call('POST', `/matches/${id}/events`, { deviceId: 'web-1', events: [{ id: eventId, type: 'goal', team: 'away', clientTimestamp: iso(T0) }] });
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', reason: 'id_conflict' });
    const rows = await db<{ team: string }[]>`select team from arbitraje.events where match_id = ${id}`;
    expect(rows).toEqual([{ team: 'home' }]);
  });

  it('keeps a tombstone for deleted matches (410) and removes their events', async () => {
    const { sql: db, call } = await apiOnDb();
    const id = randomUUID();
    await call('POST', '/matches', { id, deviceId: 'web-1' });
    await call('POST', `/matches/${id}/events`, { deviceId: 'web-1', events: [{ id: randomUUID(), type: 'match_end', clientTimestamp: iso(T0) }] });
    expect((await call('DELETE', `/matches/${id}`)).status).toBe(204);
    expect((await call('POST', '/matches', { id, deviceId: 'web-1' })).status).toBe(410);
    expect((await call('POST', `/matches/${id}/events`, { deviceId: 'web-1', events: [] })).status).toBe(410);
    expect((await db`select 1 from arbitraje.events where match_id = ${id}`).length).toBe(0);
    const [row] = await db<{ deleted_at: Date | null; summary: unknown }[]>`select deleted_at, summary from arbitraje.matches where id = ${id}`;
    expect(row!.deleted_at).not.toBeNull();
    expect(row!.summary).toBeNull();
  });

  it('ignores events the database already has, even if a write repeats them (ON CONFLICT DO NOTHING)', async () => {
    const store = new PostgresStore(sql);
    const id = randomUUID();
    const event = {
      id: randomUUID(), matchId: id, type: 'goal' as const, team: 'home' as const, playerNumber: 7, playerOutNumber: null,
      playerInNumber: null, text: null, voidsEventId: null, period: null, minutes: null, clientTimestamp: iso(T0),
      matchMinute: null, deviceId: 'w', seq: 1, createdAt: iso(T0), clockOffsetMs: 0, t: T0,
    };
    const doc = {
      match: { id }, liveToken: 't', creationFingerprint: 'f', events: [event], lastSeq: 1, deletedAt: null,
    };
    expect(await store.set(`matches/${id}`, doc, { onlyIfNew: true })).toBe(true);
    // An unconditional rewrite of the same document must not duplicate or fail.
    expect(await store.set(`matches/${id}`, doc)).toBe(true);
    const read = (await store.get<typeof doc>(`matches/${id}`))!;
    expect(read.data.events).toEqual([event]);
    expect((await sql`select 1 from arbitraje.events where match_id = ${id}`).length).toBe(1);
  });

  it('runs the full API flow from the existing test helpers on Postgres too', async () => {
    // test/api.test.ts runs entirely on Postgres in CI (TEST_STORE=postgres); this is a quick smoke here.
    const api = makeApi();
    expect((await api.call('GET', '/health', undefined, { auth: 'none' })).status).toBe(200);
  });

  it('enables RLS on every table, with no policies', async () => {
    const tables = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity from pg_class where relnamespace = 'arbitraje'::regnamespace and relkind = 'r'`;
    expect(tables.map((t) => t.relname).sort()).toEqual(
      ['devices', 'events', 'matches', 'meta', 'pairing_codes', 'rate_limits', 'schema_migrations', 'teams'],
    );
    expect(tables.every((t) => t.relrowsecurity)).toBe(true);
    expect((await sql`select 1 from pg_policies where schemaname = 'arbitraje'`).length).toBe(0);
  });

  it('removes any access for the Supabase API roles and can be re-applied', async () => {
    const { sql: db } = await freshDatabase();
    // Simulate Supabase's default grants for the API roles, then apply the migration again.
    await db.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      end $$;
      grant usage on schema arbitraje to anon, authenticated;
      grant all on all tables in schema arbitraje to anon, authenticated;`);
    await db.unsafe(MIGRATION);
    for (const role of ['anon', 'authenticated']) {
      const [r] = await db<{ select: boolean; insert: boolean; usage: boolean }[]>`
        select has_table_privilege(${role}, 'arbitraje.events', 'select') as select,
               has_table_privilege(${role}, 'arbitraje.matches', 'insert') as insert,
               has_schema_privilege(${role}, 'arbitraje', 'usage') as usage`;
      expect(r).toEqual({ select: false, insert: false, usage: false });
    }
  });

  afterAll(async () => {
    // Connections are closed by test/setup.ts.
  });
});
