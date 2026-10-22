// Offline-first sync against the real API code (in process), with IndexedDB faked in memory.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.ts';
import { hashPassphrase } from '../../server/crypto.ts';
import { MemoryStore } from '../../server/store.ts';
import { configureApi } from './api.ts';
import { getDb, resetDbForTests } from './db.ts';
import { addEvent, createMatch, deleteMatch, getMatchView, pendingCount, resetMatch, saveTeam, undoLast } from './repo.ts';
import { getSyncStatus, login, syncNow } from './sync.ts';

const PASSPHRASE = 'frase de prueba larga';
const HASH = hashPassphrase(PASSPHRASE);

function setup() {
  const store = new MemoryStore();
  const server = createApp({
    store,
    env: { ADMIN_PASSPHRASE_HASH: HASH, SESSION_SECRET: 'x'.repeat(40) },
    now: Date.now,
    uuid: randomUUID,
    secureCookies: true,
  });
  const net = { online: true, dropResponses: false, requests: 0 };
  let cookie = '';
  configureApi({
    base: 'https://arbitrajeremoto.test/api/v1',
    fetch: async (url, init = {}) => {
      if (!net.online) throw new TypeError('Failed to fetch');
      net.requests++;
      const headers = new Headers(init.headers);
      if (cookie) headers.set('cookie', cookie);
      const res = await server.handle(new Request(url, { ...init, headers }), '127.0.0.1');
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0]!;
      // Simulates a connection that dies after the server already saved the request.
      if (net.dropResponses) throw new TypeError('Network connection was lost');
      return res;
    },
  });
  Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return net.online; } }, configurable: true });
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const headers: Record<string, string> = { cookie };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await server.handle(
      new Request(`https://arbitrajeremoto.test/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      '127.0.0.1',
    );
    return res.status === 204 ? null : res.json();
  };
  return { store, net, server: call };
}

const quickMatch = () =>
  createMatch({ homeTeamId: null, awayTeamId: null, homeTeamName: 'Local', awayTeamName: 'Visitante', scheduledAt: null, periods: 2, periodMinutes: 45, tournament: null });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

describe('offline quick match', () => {
  it('records offline and syncs once without duplicates when the connection returns', async () => {
    const { net, server } = setup();
    await login(PASSPHRASE);
    net.online = false;

    const id = await quickMatch();
    await addEvent(id, { type: 'period_start', period: 1 });
    await addEvent(id, { type: 'goal', team: 'home', playerNumber: 9 });
    await addEvent(id, { type: 'yellow_card', team: 'away', playerNumber: 4 });
    await addEvent(id, { type: 'note', text: 'Sin conexión en el campo' });
    expect(await pendingCount()).toBe(5);
    expect((await syncNow()).phase).toBe('offline');
    expect(await pendingCount()).toBe(5);

    net.online = true;
    await syncNow();
    expect(getSyncStatus()).toMatchObject({ phase: 'idle', pending: 0 });

    const remote = await server(`/matches/${id}?include=events`);
    expect(remote.events).toHaveLength(4);
    expect(remote.state.score).toEqual({ home: 1, away: 0 });
    expect(remote.match.homeTeamName).toBe('Local');

    // Syncing again (or many times) changes nothing.
    await syncNow();
    await syncNow();
    expect((await server(`/matches/${id}?include=events`)).events).toHaveLength(4);
    const local = await getMatchView(id);
    expect(local!.events.every((e) => e.syncStatus === 'synced')).toBe(true);
    expect(local!.match.liveToken).toBeTruthy();
  });

  it('does not duplicate when responses are lost after the server saved them', async () => {
    const { net, server } = setup();
    await login(PASSPHRASE);
    const id = await quickMatch();
    await addEvent(id, { type: 'period_start', period: 1 });
    await addEvent(id, { type: 'goal', team: 'away' });

    net.dropResponses = true;
    await syncNow();
    expect(getSyncStatus().phase).toBe('offline');
    expect(await pendingCount()).toBe(3);

    net.dropResponses = false;
    await syncNow();
    expect(await pendingCount()).toBe(0);
    const remote = await server(`/matches/${id}?include=events`);
    expect(remote.events).toHaveLength(2);
    expect((await server('/matches')).matches).toHaveLength(1);
  });

  it('works fully offline without ever logging in, and syncs after login', async () => {
    const { server } = setup();
    const id = await quickMatch();
    await addEvent(id, { type: 'period_start', period: 1 });
    expect((await syncNow()).phase).toBe('needsLogin');
    expect(await pendingCount()).toBe(2);
    await login(PASSPHRASE);
    await syncNow();
    expect(await pendingCount()).toBe(0);
    expect((await server(`/matches/${id}`)).state.status).toBe('live');
  });
});

describe('undo, reset and deletes', () => {
  it('undo and reset are void events that sync like any other', async () => {
    const { server } = setup();
    await login(PASSPHRASE);
    const id = await quickMatch();
    await addEvent(id, { type: 'period_start', period: 1 });
    await addEvent(id, { type: 'goal', team: 'home' });
    const undone = await undoLast(id);
    expect(undone?.type).toBe('goal');
    expect((await getMatchView(id))!.state.score.home).toBe(0);
    await addEvent(id, { type: 'goal', team: 'away' });
    expect(await resetMatch(id)).toBe(2);
    const local = await getMatchView(id);
    expect(local!.state.status).toBe('scheduled');
    await syncNow();
    const remote = await server(`/matches/${id}?include=events`);
    expect(remote.state).toMatchObject({ status: 'scheduled', score: { home: 0, away: 0 } });
    expect(remote.events).toHaveLength(6);
  });

  it('deleting a match that never reached the server sends nothing', async () => {
    const { net, server } = setup();
    await login(PASSPHRASE);
    net.online = false;
    const id = await quickMatch();
    await addEvent(id, { type: 'period_start', period: 1 });
    await deleteMatch(id);
    expect(await pendingCount()).toBe(0);
    net.online = true;
    const before = net.requests;
    await syncNow();
    expect(net.requests - before).toBe(3); // session + pull (teams, matches): no match or event writes
    expect(await (await getDb()).count('matches')).toBe(0);
    expect((await server('/matches')).matches).toEqual([]);
  });

  it('pushes teams and pulls matches created elsewhere (e.g. the watch)', async () => {
    const { server } = setup();
    await login(PASSPHRASE);
    await saveTeam({ id: randomUUID(), name: 'Halcones', players: [{ id: randomUUID(), number: 9, name: 'Mora' }] });
    await syncNow();
    expect((await server('/teams')).teams).toHaveLength(1);

    const watchMatch = randomUUID();
    await server('/matches', 'POST', { id: watchMatch, deviceId: 'watch-1' });
    await server(`/matches/${watchMatch}/events`, 'POST', {
      deviceId: 'watch-1',
      events: [{ id: randomUUID(), type: 'period_start', period: 1, clientTimestamp: new Date().toISOString() }],
    });
    await syncNow();
    const local = await getMatchView(watchMatch);
    expect(local?.state.status).toBe('live');
    expect(local?.events[0]?.deviceId).toBe('watch-1');

    await server(`/matches/${watchMatch}`, 'DELETE');
    await syncNow();
    expect(await getMatchView(watchMatch)).toBeNull();
  });
});
