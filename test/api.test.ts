import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIN, T0, iso, makeApi, shuffle } from './helpers.ts';

type Api = ReturnType<typeof makeApi>;

function sampleEvents(matchId: string) {
  const goalId = randomUUID();
  return [
    { id: randomUUID(), matchId, type: 'period_start', period: 1, clientTimestamp: iso(T0) },
    { id: goalId, type: 'goal', team: 'home', playerNumber: 9, clientTimestamp: iso(T0 + 12 * MIN) },
    { id: randomUUID(), type: 'yellow_card', team: 'away', playerNumber: 4, clientTimestamp: iso(T0 + 15 * MIN) },
    { id: randomUUID(), type: 'void', voidsEventId: goalId, clientTimestamp: iso(T0 + 16 * MIN) },
    { id: randomUUID(), type: 'goal', team: 'away', playerNumber: 11, clientTimestamp: iso(T0 + 30 * MIN) },
    { id: randomUUID(), type: 'note', text: 'Banderín roto', clientTimestamp: iso(T0 + 31 * MIN) },
    { id: randomUUID(), type: 'period_end', period: 1, clientTimestamp: iso(T0 + 47 * MIN) },
  ];
}

async function createMatch(api: Api, extra: Record<string, unknown> = {}) {
  const res = await api.call('POST', '/matches', { homeTeamName: 'Halcones', awayTeamName: 'Toros', deviceId: 'web-1', ...extra });
  expect(res.status).toBe(201);
  return res.body.match as { id: string; liveToken: string };
}

describe('session', () => {
  it('rejects requests without credentials', async () => {
    const api = makeApi();
    expect((await api.call('GET', '/matches', undefined, { auth: 'none' })).status).toBe(401);
  });

  it('logs in with the passphrase and sets a secure cookie', async () => {
    const api = makeApi();
    const res = await api.login();
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect((await api.call('GET', '/session')).body).toEqual({ authenticated: true, role: 'owner' });
  });

  it('rate-limits wrong passphrases per IP', async () => {
    const api = makeApi();
    for (let i = 0; i < 5; i++) {
      expect((await api.call('POST', '/session', { passphrase: 'nope nope nope' }, { auth: 'none' })).status).toBe(401);
    }
    const blocked = await api.call('POST', '/session', { passphrase: 'correct horse battery staple' }, { auth: 'none' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    api.setIp('198.51.100.1');
    expect((await api.call('POST', '/session', { passphrase: 'correct horse battery staple' }, { auth: 'none' })).status).toBe(200);
  });

  it('expires sessions after 30 days', async () => {
    const api = makeApi();
    await api.login();
    api.clock.now += 31 * 24 * 60 * MIN;
    expect((await api.call('GET', '/matches')).status).toBe(401);
  });
});

describe('matches', () => {
  let api: Api;
  beforeEach(async () => {
    api = makeApi();
    await api.login();
  });

  it('creates with defaults (Local/Visitante, 2×45) and lists', async () => {
    const res = await api.call('POST', '/matches', { deviceId: 'web-1' });
    expect(res.status).toBe(201);
    expect(res.body.match).toMatchObject({ homeTeamName: 'Local', awayTeamName: 'Visitante', periods: 2, periodMinutes: 45 });
    expect(res.body.state.status).toBe('scheduled');
    const list = await api.call('GET', '/matches?status=scheduled,live&fields=homeTeamName,status');
    expect(list.body.matches).toEqual([{ id: res.body.match.id, homeTeamName: 'Local', status: 'scheduled' }]);
  });

  it('accepts a client id and is idempotent', async () => {
    const id = randomUUID();
    const body = { id, homeTeamName: 'A', awayTeamName: 'B', deviceId: 'web-1' };
    const first = await api.call('POST', '/matches', body);
    const again = await api.call('POST', '/matches', body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.match).toEqual(first.body.match);
    const conflict = await api.call('POST', '/matches', { ...body, homeTeamName: 'Otro' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('ID_CONFLICT');
    expect((await api.call('GET', '/matches')).body.matches).toHaveLength(1);
  });

  it('still recognizes a resent create after the owner edited the match', async () => {
    const id = randomUUID();
    const body = { id, homeTeamName: 'A', awayTeamName: 'B', deviceId: 'web-1' };
    await api.call('POST', '/matches', body);
    await api.call('PATCH', `/matches/${id}`, { tournament: 'Liga' });
    const again = await api.call('POST', '/matches', body);
    expect(again.status).toBe(200);
    expect(again.body.match.tournament).toBe('Liga');
  });

  it('uses team names from rosters and validates input', async () => {
    const teamId = randomUUID();
    await api.call('PUT', `/teams/${teamId}`, { name: 'Club Norte', players: [{ number: 1 }] });
    const res = await api.call('POST', '/matches', { homeTeamId: teamId, deviceId: 'web-1' });
    expect(res.body.match.homeTeamName).toBe('Club Norte');
    const bad = await api.call('POST', '/matches', { periodMinutes: 0, deviceId: 'web-1' });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'invalid_periodMinutes' } });
    expect((await api.call('POST', '/matches', { homeTeamId: randomUUID() })).status).toBe(422);
  });

  it('patches and deletes (tombstone)', async () => {
    const m = await createMatch(api);
    const patched = await api.call('PATCH', `/matches/${m.id}`, { periodMinutes: 30, rotateLiveToken: true });
    expect(patched.body.match.periodMinutes).toBe(30);
    expect(patched.body.match.liveToken).not.toBe(m.liveToken);
    expect((await api.call('DELETE', `/matches/${m.id}`)).status).toBe(204);
    expect((await api.call('GET', `/matches/${m.id}`)).status).toBe(404);
    expect((await api.call('GET', '/matches')).body.matches).toEqual([]);
    const resend = await api.call('POST', '/matches', { id: m.id, homeTeamName: 'Halcones', awayTeamName: 'Toros', deviceId: 'web-1' });
    expect(resend.status).toBe(410);
    expect((await api.call('POST', `/matches/${m.id}/events`, { deviceId: 'web-1', events: [] })).status).toBe(410);
  });

  it('answers 404 for unknown ids and 405 for wrong methods', async () => {
    expect((await api.call('GET', `/matches/${randomUUID()}`)).status).toBe(404);
    expect((await api.call('GET', '/matches/not-a-uuid')).status).toBe(404);
    const res = await api.call('PUT', '/matches');
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, POST');
  });
});

describe('event batches', () => {
  let api: Api;
  let matchId: string;
  beforeEach(async () => {
    api = makeApi();
    await api.login();
    matchId = (await createMatch(api)).id;
    api.clock.now = T0 + 50 * MIN;
  });

  it('accepts a batch and returns the derived state', async () => {
    const res = await api.call('POST', `/matches/${matchId}/events`, { deviceId: 'web-1', sentAt: iso(api.clock.now), events: sampleEvents(matchId) });
    expect(res.status).toBe(200);
    expect(res.body.results.every((r: { status: string }) => r.status === 'accepted')).toBe(true);
    expect(res.body.state).toMatchObject({ status: 'halftime', score: { home: 0, away: 1 }, lastSeq: 7 });
  });

  it('sending the same batch 3 times leaves exactly the same data', async () => {
    const events = sampleEvents(matchId);
    const send = () => api.call('POST', `/matches/${matchId}/events`, { deviceId: 'web-1', sentAt: iso(api.clock.now), events });
    const first = await send();
    const snapshot = await api.store.get(`matches/${matchId}`);
    const second = await send();
    const third = await send();
    expect(second.body.results.map((r: { status: string }) => r.status)).toEqual(Array(7).fill('duplicate'));
    expect(third.body.results).toEqual(second.body.results);
    expect(third.body.state).toEqual(first.body.state);
    expect((await api.store.get(`matches/${matchId}`))!.data).toEqual(snapshot!.data);
    expect((await api.call('GET', `/matches/${matchId}/events`)).body.events).toHaveLength(7);
  });

  it('gives the same state whatever the order and split of batches', async () => {
    const events = sampleEvents(matchId);
    const reference = await api.call('POST', `/matches/${matchId}/events`, { deviceId: 'web-1', events });
    for (const seed of [3, 11]) {
      const other = makeApi();
      await other.login();
      await other.call('POST', '/matches', { id: matchId, homeTeamName: 'Halcones', awayTeamName: 'Toros', deviceId: 'web-1' });
      other.clock.now = api.clock.now;
      const shuffled = shuffle(events, seed);
      await other.call('POST', `/matches/${matchId}/events`, { deviceId: 'web-1', events: shuffled.slice(0, 3) });
      const last = await other.call('POST', `/matches/${matchId}/events`, { deviceId: 'web-1', events: shuffled.slice(3) });
      expect(last.body.state).toEqual(reference.body.state);
    }
  });

  it('reports per-event rejections without failing the batch', async () => {
    const good = { id: randomUUID(), type: 'period_start', period: 1, clientTimestamp: iso(T0) };
    const res = await api.call('POST', `/matches/${matchId}/events`, {
      deviceId: 'web-1',
      events: [
        good,
        { ...good, period: 2 },
        { id: randomUUID(), type: 'goal', team: 'home', playerNumber: 120, clientTimestamp: iso(T0) },
        { id: randomUUID(), type: 'goal', team: 'home', clientTimestamp: iso(T0 + 2 * 60 * MIN) },
        { id: randomUUID(), type: 'period_start', period: 3, clientTimestamp: iso(T0) },
        { id: randomUUID(), matchId: randomUUID(), type: 'match_end', clientTimestamp: iso(T0) },
        { nonsense: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { id: good.id, status: 'accepted' },
      { id: good.id, status: 'rejected', reason: 'id_conflict' },
      expect.objectContaining({ status: 'rejected', reason: 'invalid_playerNumber' }),
      expect.objectContaining({ status: 'rejected', reason: 'timestamp_in_future' }),
      expect.objectContaining({ status: 'rejected', reason: 'period_out_of_range' }),
      expect.objectContaining({ status: 'rejected', reason: 'match_mismatch' }),
      { id: null, status: 'rejected', reason: 'invalid_id' },
    ]);
  });

  it('rejects voiding a void', async () => {
    const goal = { id: randomUUID(), type: 'goal', team: 'home', clientTimestamp: iso(T0 + MIN) };
    const undo = { id: randomUUID(), type: 'void', voidsEventId: goal.id, clientTimestamp: iso(T0 + 2 * MIN) };
    const redo = { id: randomUUID(), type: 'void', voidsEventId: undo.id, clientTimestamp: iso(T0 + 3 * MIN) };
    const res = await api.call('POST', `/matches/${matchId}/events`, { deviceId: 'web-1', events: [goal, undo, redo] });
    expect(res.body.results[2]).toMatchObject({ status: 'rejected', reason: 'cannot_void_a_void' });
    expect(res.body.state.score.home).toBe(0);
  });

  it('corrects a device clock that is 10 minutes ahead using sentAt', async () => {
    const skew = 10 * MIN;
    const res = await api.call('POST', `/matches/${matchId}/events`, {
      deviceId: 'web-1',
      sentAt: iso(api.clock.now + skew),
      events: [
        { id: randomUUID(), type: 'period_start', period: 1, clientTimestamp: iso(T0 + skew) },
        { id: randomUUID(), type: 'goal', team: 'home', clientTimestamp: iso(T0 + skew + 20 * MIN) },
      ],
    });
    expect(res.body.clockOffsetMs).toBe(-skew);
    const events = (await api.call('GET', `/matches/${matchId}/events`)).body.events;
    expect(events[0].t).toBe(T0);
    expect(res.body.state.clock.anchorAt).toBe(T0);
  });

  it('returns only newer events with ?since=', async () => {
    await api.call('POST', `/matches/${matchId}/events`, { deviceId: 'web-1', events: sampleEvents(matchId) });
    const res = await api.call('GET', `/matches/${matchId}/events?since=5`);
    expect(res.body.events.map((e: { seq: number }) => e.seq)).toEqual([6, 7]);
    expect(res.body.lastSeq).toBe(7);
    expect((await api.call('GET', `/matches/${matchId}/events?since=-1`)).status).toBe(400);
  });

  it('enforces size limits and JSON content type', async () => {
    const many = Array.from({ length: 201 }, () => ({ id: randomUUID(), type: 'match_end', clientTimestamp: iso(T0) }));
    expect((await api.call('POST', `/matches/${matchId}/events`, { deviceId: 'web-1', events: many })).status).toBe(413);
    const huge = { deviceId: 'web-1', events: [], pad: 'x'.repeat(70 * 1024) };
    expect((await api.call('POST', `/matches/${matchId}/events`, huge)).status).toBe(413);
    const res = await api.call('POST', `/matches/${matchId}/events`, '{"events":[]}', { headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
    expect((await api.call('POST', `/matches/${matchId}/events`, '{bad json')).status).toBe(400);
    expect((await api.call('POST', `/matches/${matchId}/events`, { events: [] })).status).toBe(422);
  });

  it('survives a concurrent writer (optimistic concurrency)', async () => {
    const mine = { id: randomUUID(), type: 'period_start', period: 1, clientTimestamp: iso(T0) };
    const theirs = { id: randomUUID(), type: 'goal', team: 'away', clientTimestamp: iso(T0 + MIN) };
    api.store.beforeWrite = async (key) => {
      if (key !== `matches/${matchId}`) return;
      // Another device writes between our read and our write.
      await api.call('POST', `/matches/${matchId}/events`, { deviceId: 'web-2', events: [theirs] });
    };
    const res = await api.call('POST', `/matches/${matchId}/events`, { deviceId: 'web-1', events: [mine] });
    expect(res.body.results).toEqual([{ id: mine.id, status: 'accepted' }]);
    expect(res.body.state).toMatchObject({ status: 'live', score: { home: 0, away: 1 }, lastSeq: 2 });
    const list = await api.call('GET', '/matches');
    expect(list.body.matches[0]).toMatchObject({ status: 'live', lastSeq: 2 });
  });
});

describe('live view', () => {
  it('needs the token and hides private data', async () => {
    const api = makeApi();
    await api.login();
    const m = await createMatch(api);
    api.clock.now = T0 + 50 * MIN;
    await api.call('POST', `/matches/${m.id}/events`, { deviceId: 'web-1', events: sampleEvents(m.id) });

    expect((await api.call('GET', `/matches/${m.id}/live`, undefined, { auth: 'none' })).status).toBe(404);
    expect((await api.call('GET', `/matches/${m.id}/live?token=wrong`, undefined, { auth: 'none' })).status).toBe(404);
    const res = await api.call('GET', `/matches/${m.id}/live?token=${m.liveToken}`, undefined, { auth: 'none' });
    expect(res.status).toBe(200);
    expect(res.body.state.score).toEqual({ home: 0, away: 1 });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Banderín');
    expect(text).not.toContain('web-1');
    expect(text).not.toContain(m.liveToken);
    expect(res.body.timeline.map((e: { type: string }) => e.type)).toEqual(['period_start', 'yellow_card', 'goal', 'period_end']);

    const etag = res.headers.get('etag')!;
    const cached = await api.call('GET', `/matches/${m.id}/live?token=${m.liveToken}`, undefined, {
      auth: 'none',
      headers: { 'if-none-match': etag },
    });
    expect(cached.status).toBe(304);
  });
});

describe('teams', () => {
  it('creates, replaces, lists and deletes rosters', async () => {
    const api = makeApi();
    await api.login();
    const id = randomUUID();
    const created = await api.call('PUT', `/teams/${id}`, { name: ' Club Sur ', players: [{ number: 10, name: 'Ana' }, { number: 1 }] });
    expect(created.status).toBe(201);
    expect(created.body.team).toMatchObject({ name: 'Club Sur', players: [{ number: 1 }, { number: 10, name: 'Ana' }] });
    const replaced = await api.call('PUT', `/teams/${id}`, { name: 'Club Sur', players: [] });
    expect(replaced.status).toBe(200);
    expect((await api.call('GET', '/teams')).body.teams).toHaveLength(1);
    expect((await api.call('PUT', `/teams/${id}`, { name: 'X', players: [{ number: 5 }, { number: 5 }] })).status).toBe(422);
    expect((await api.call('DELETE', `/teams/${id}`)).status).toBe(204);
    expect((await api.call('DELETE', `/teams/${id}`)).status).toBe(404);
  });
});

describe('watch pairing', () => {
  let api: Api;
  beforeEach(async () => {
    api = makeApi();
    await api.login();
  });

  it('runs request → approve → poll and gives a working device key once', async () => {
    const req = await api.call('POST', '/pairing/request', { deviceId: 'watch-1', deviceName: 'Galaxy Watch4' }, { auth: 'none' });
    expect(req.status).toBe(201);
    expect(req.body.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    const poll = () => api.call('POST', '/pairing/poll', { code: req.body.code, pollToken: req.body.pollToken }, { auth: 'none' });

    expect((await poll()).status).toBe(202);
    const approve = await api.call('POST', '/pairing/approve', { code: req.body.code.toLowerCase().replace(/^(...)/, '$1-') });
    expect(approve.status).toBe(200);
    const done = await poll();
    expect(done.status).toBe(200);
    expect(done.body.deviceKey).toMatch(/^ark1_[0-9a-f]{16}_/);
    const again = await poll();
    expect(again.status).toBe(410);
    expect(again.body.error.code).toBe('CODE_USED');

    const key = done.body.deviceKey as string;
    expect((await api.call('GET', '/session', undefined, { auth: key })).body).toMatchObject({ role: 'device', deviceId: 'watch-1' });
    const devices = (await api.call('GET', '/devices')).body.devices;
    expect(devices).toHaveLength(1);
    expect(JSON.stringify(devices)).not.toContain('secretHash');
  });

  it('refuses expired codes, used codes and wrong poll tokens', async () => {
    const req = await api.call('POST', '/pairing/request', { deviceId: 'watch-1' }, { auth: 'none' });
    expect((await api.call('POST', '/pairing/poll', { code: req.body.code, pollToken: 'x' }, { auth: 'none' })).status).toBe(404);
    api.clock.now += 10 * MIN + 1;
    const expired = await api.call('POST', '/pairing/approve', { code: req.body.code });
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('CODE_EXPIRED');

    const req2 = await api.call('POST', '/pairing/request', { deviceId: 'watch-1' }, { auth: 'none' });
    expect((await api.call('POST', '/pairing/approve', { code: req2.body.code })).status).toBe(200);
    const twice = await api.call('POST', '/pairing/approve', { code: req2.body.code });
    expect(twice.body.error.code).toBe('CODE_USED');
  });

  it('only the owner can approve, and wrong codes are rate-limited', async () => {
    const req = await api.call('POST', '/pairing/request', { deviceId: 'watch-1' }, { auth: 'none' });
    expect((await api.call('POST', '/pairing/approve', { code: req.body.code }, { auth: 'none' })).status).toBe(401);
    for (let i = 0; i < 10; i++) {
      expect((await api.call('POST', '/pairing/approve', { code: 'AAAAAA' })).status).toBe(404);
    }
    expect((await api.call('POST', '/pairing/approve', { code: req.body.code })).status).toBe(429);
  });

  it('limits code requests per IP', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await api.call('POST', '/pairing/request', { deviceId: 'w' }, { auth: 'none' })).status).toBe(201);
    }
    expect((await api.call('POST', '/pairing/request', { deviceId: 'w' }, { auth: 'none' })).status).toBe(429);
  });

  it('device keys can read matches and write events, not administer', async () => {
    const key = await api.pairDevice('watch-1');
    const id = randomUUID();
    const created = await api.call('POST', '/matches', { id }, { auth: key });
    expect(created.status).toBe(201);
    expect(created.body.match).toMatchObject({ homeTeamName: 'Local', awayTeamName: 'Visitante', createdByDeviceId: 'watch-1' });
    expect(created.body.match.liveToken).toBeUndefined();
    expect((await api.call('POST', '/matches', { id }, { auth: key })).status).toBe(200);

    const batch = await api.call(
      'POST',
      `/matches/${id}/events`,
      { events: [{ id: randomUUID(), type: 'period_start', period: 1, clientTimestamp: iso(T0) }] },
      { auth: key },
    );
    expect(batch.body.results[0].status).toBe('accepted');
    const events = (await api.call('GET', `/matches/${id}/events`, undefined, { auth: key })).body.events;
    expect(events[0].deviceId).toBe('watch-1');

    const spoof = await api.call(
      'POST',
      `/matches/${id}/events`,
      { events: [{ id: randomUUID(), type: 'match_end', clientTimestamp: iso(T0), deviceId: 'other' }] },
      { auth: key },
    );
    expect(spoof.body.results[0]).toMatchObject({ status: 'rejected', reason: 'device_mismatch' });

    expect((await api.call('PATCH', `/matches/${id}`, { tournament: 'x' }, { auth: key })).status).toBe(403);
    expect((await api.call('DELETE', `/matches/${id}`, undefined, { auth: key })).status).toBe(403);
    expect((await api.call('PUT', `/teams/${randomUUID()}`, { name: 'x' }, { auth: key })).status).toBe(403);
    expect((await api.call('GET', '/devices', undefined, { auth: key })).status).toBe(403);
    expect((await api.call('POST', '/pairing/approve', { code: 'AAAAAA' }, { auth: key })).status).toBe(403);
  });

  it('revoked or replaced keys stop working', async () => {
    const key = await api.pairDevice('watch-1');
    const keyId = key.split('_')[1]!;
    expect((await api.call('GET', '/matches', undefined, { auth: key })).status).toBe(200);
    expect((await api.call('DELETE', `/devices/${keyId}`)).status).toBe(204);
    expect((await api.call('GET', '/matches', undefined, { auth: key })).status).toBe(401);

    const key2 = await api.pairDevice('watch-1');
    const key3 = await api.pairDevice('watch-1');
    expect((await api.call('GET', '/matches', undefined, { auth: key2 })).status).toBe(401);
    expect((await api.call('GET', '/matches', undefined, { auth: key3 })).status).toBe(200);
    expect((await api.call('GET', '/matches', undefined, { auth: 'ark1_garbage' })).status).toBe(401);
  });
});

describe('configuration', () => {
  it('reports a clear error when secrets are missing', async () => {
    const { createApp } = await import('../server/app.ts');
    const { MemoryStore } = await import('../server/store.ts');
    const app = createApp({ store: new MemoryStore(), env: {}, now: Date.now, uuid: randomUUID, secureCookies: true });
    const res = await app.handle(
      new Request('https://x.test/api/v1/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase: 'whatever whatever' }),
      }),
      '1.1.1.1',
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('SERVER_MISCONFIGURED');
    const health = await app.handle(new Request('https://x.test/api/v1/health'), '1.1.1.1');
    expect(health.status).toBe(200);
  });
});
