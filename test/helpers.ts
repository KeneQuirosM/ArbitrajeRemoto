// Test helpers: an API with a controllable clock, on an in-memory store or, with
// TEST_STORE=postgres, on a fresh Postgres database per makeApi() (see test/pg.ts).

import { randomUUID } from 'node:crypto';
import type { StoredEvent } from '../core/types.ts';
import { createApp } from '../server/app.ts';
import { hashPassphrase } from '../server/crypto.ts';
import { MemoryStore } from '../server/store.ts';
import { LazyPostgresStore, PG_URL } from './pg.ts';

export const USE_POSTGRES = process.env.TEST_STORE === 'postgres';
if (USE_POSTGRES && !PG_URL) throw new Error('TEST_STORE=postgres needs TEST_DATABASE_URL');

export const PASSPHRASE = 'correct horse battery staple';
export const PASSPHRASE_HASH = hashPassphrase(PASSPHRASE);
export const SESSION_SECRET = 'test-secret-test-secret-test-secret-0123';
export const T0 = Date.parse('2026-10-25T16:00:00.000Z');

export function makeApi() {
  const store = USE_POSTGRES ? new LazyPostgresStore() : new MemoryStore();
  const clock = { now: T0 };
  const app = createApp({
    store,
    env: { ADMIN_PASSPHRASE_HASH: PASSPHRASE_HASH, SESSION_SECRET },
    now: () => clock.now,
    uuid: randomUUID,
    secureCookies: true,
  });
  let cookie: string | null = null;
  let ip = '203.0.113.7';

  async function call(
    method: string,
    path: string,
    body?: unknown,
    options: { auth?: 'owner' | 'none' | string; headers?: Record<string, string> } = {},
  ) {
    const headers: Record<string, string> = { ...options.headers };
    const auth = options.auth ?? 'owner';
    if (auth === 'owner' && cookie) headers.cookie = cookie;
    else if (auth !== 'owner' && auth !== 'none') headers.authorization = `Bearer ${auth}`;
    if (body !== undefined) headers['content-type'] ??= 'application/json';
    const res = await app.handle(
      new Request(`https://arbitrajeremoto.test/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      }),
      ip,
    );
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }

  async function login() {
    const res = await call('POST', '/session', { passphrase: PASSPHRASE }, { auth: 'none' });
    if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
    cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    return res;
  }

  /** Runs the full watch pairing flow and returns the device key. */
  async function pairDevice(deviceId = 'watch-1') {
    const req = await call('POST', '/pairing/request', { deviceId, deviceName: 'Galaxy Watch4' }, { auth: 'none' });
    await call('POST', '/pairing/approve', { code: req.body.code });
    const poll = await call('POST', '/pairing/poll', { code: req.body.code, pollToken: req.body.pollToken }, { auth: 'none' });
    return poll.body.deviceKey as string;
  }

  return {
    store,
    clock,
    call,
    login,
    pairDevice,
    setIp: (value: string) => (ip = value),
  };
}

export const iso = (ms: number) => new Date(ms).toISOString();

let counter = 0;
/** A stored event for pure derivation tests. */
export function ev(type: StoredEvent['type'], tMs: number, extra: Partial<StoredEvent> = {}): StoredEvent {
  counter++;
  return {
    id: extra.id ?? randomUUID(),
    matchId: 'm',
    type,
    team: null,
    playerNumber: null,
    playerOutNumber: null,
    playerInNumber: null,
    text: null,
    voidsEventId: null,
    period: null,
    minutes: null,
    clientTimestamp: iso(tMs),
    matchMinute: null,
    deviceId: 'd',
    seq: counter,
    createdAt: iso(tMs),
    clockOffsetMs: 0,
    t: tMs,
    ...extra,
  };
}

export const MIN = 60_000;

export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
