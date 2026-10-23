// Loads demo data through the public API (works locally and on Vercel).
// Usage: BASE=http://localhost:8787/api/v1 PASSPHRASE='...' npm run seed
// Fixed ids: running it again skips the matches that already exist.

const BASE = process.env.BASE ?? 'http://localhost:8787/api/v1';
const PASSPHRASE = process.env.PASSPHRASE;
if (!PASSPHRASE) {
  console.error('Set PASSPHRASE to the owner passphrase.');
  process.exit(1);
}

let cookie = '';

async function exists(path: string): Promise<boolean> {
  const res = await fetch(BASE + path, { headers: { cookie } });
  return res.status === 200;
}

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!;
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const ids = {
  halcones: '11111111-1111-4111-8111-000000000001',
  toros: '11111111-1111-4111-8111-000000000002',
  linces: '11111111-1111-4111-8111-000000000003',
  scheduled: '22222222-2222-4222-8222-000000000001',
  live: '22222222-2222-4222-8222-000000000002',
  finished: '22222222-2222-4222-8222-000000000003',
};
const ev = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const roster = (numbers: number[], names: Record<number, string> = {}) =>
  numbers.map((number) => ({ id: `44444444-4444-4444-8444-${String(number).padStart(12, '0')}`, number, name: names[number] ?? null }));

const day = 24 * 60 * 60_000;
const min = 60_000;
const at = (ms: number) => new Date(ms).toISOString();
const now = Date.now();

await api('POST', '/session', { passphrase: PASSPHRASE });

await api('PUT', `/teams/${ids.halcones}`, { name: 'Halcones', players: roster([1, 2, 4, 5, 7, 8, 9, 10, 11, 14, 16], { 1: 'Ruiz', 9: 'Mora', 10: 'Solís' }) });
await api('PUT', `/teams/${ids.toros}`, { name: 'Toros', players: roster([1, 3, 4, 6, 7, 8, 9, 10, 11, 15, 20]) });
await api('PUT', `/teams/${ids.linces}`, { name: 'Linces', players: [] });

if (!(await exists(`/matches/${ids.scheduled}`))) {
  await api('POST', '/matches', { id: ids.scheduled, homeTeamId: ids.linces, awayTeamId: ids.halcones, scheduledAt: at(now + 3 * day), tournament: 'Liga de prueba', deviceId: 'seed' });
}

// Live match: kicked off 25 minutes ago, one pause, 1-1.
const k = now - 25 * min;
if (!(await exists(`/matches/${ids.live}`))) {
  await api('POST', '/matches', { id: ids.live, homeTeamId: ids.halcones, awayTeamId: ids.toros, scheduledAt: at(now - 30 * min), tournament: 'Liga de prueba', deviceId: 'seed' });
  await api('POST', `/matches/${ids.live}/events`, {
    deviceId: 'seed',
    sentAt: at(Date.now()),
    events: [
      { id: ev(1), type: 'period_start', period: 1, clientTimestamp: at(k) },
      { id: ev(2), type: 'goal', team: 'home', playerNumber: 9, clientTimestamp: at(k + 6 * min) },
      { id: ev(3), type: 'yellow_card', team: 'away', playerNumber: 4, clientTimestamp: at(k + 9 * min) },
      { id: ev(4), type: 'period_pause', period: 1, clientTimestamp: at(k + 12 * min) },
      { id: ev(5), type: 'period_resume', period: 1, clientTimestamp: at(k + 14 * min) },
      { id: ev(6), type: 'goal', team: 'away', playerNumber: 10, clientTimestamp: at(k + 20 * min) },
      { id: ev(7), type: 'note', text: 'Lesión leve del 7 local, sigue jugando', clientTimestamp: at(k + 21 * min) },
    ],
  });
}

// Finished match a week ago: 2×40, 2-1 with an own goal, a substitution and a second yellow.
const f = now - 7 * day;
if (!(await exists(`/matches/${ids.finished}`))) {
  await api('POST', '/matches', { id: ids.finished, homeTeamId: ids.toros, awayTeamId: ids.linces, scheduledAt: at(now - 7 * day), periodMinutes: 40, deviceId: 'seed' });
  await api('POST', `/matches/${ids.finished}/events`, {
    deviceId: 'seed',
    sentAt: at(Date.now()),
    events: [
      { id: ev(101), type: 'period_start', period: 1, clientTimestamp: at(f) },
      { id: ev(102), type: 'goal', team: 'home', playerNumber: 11, clientTimestamp: at(f + 17 * min) },
      { id: ev(103), type: 'yellow_card', team: 'away', playerNumber: 6, clientTimestamp: at(f + 25 * min) },
      { id: ev(104), type: 'added_time', minutes: 2, clientTimestamp: at(f + 39 * min) },
      { id: ev(105), type: 'period_end', period: 1, clientTimestamp: at(f + 42 * min) },
      { id: ev(106), type: 'period_start', period: 2, clientTimestamp: at(f + 55 * min) },
      { id: ev(107), type: 'own_goal', team: 'home', playerNumber: 4, clientTimestamp: at(f + 61 * min) },
      { id: ev(108), type: 'substitution', team: 'home', playerOutNumber: 9, playerInNumber: 15, clientTimestamp: at(f + 70 * min) },
      { id: ev(109), type: 'yellow_card', team: 'away', playerNumber: 6, clientTimestamp: at(f + 80 * min) },
      { id: ev(110), type: 'goal', team: 'home', playerNumber: 15, clientTimestamp: at(f + 93 * min) },
      { id: ev(111), type: 'period_end', period: 2, clientTimestamp: at(f + 97 * min) },
    ],
  });
}

const list = await api('GET', '/matches?fields=homeTeamName,awayTeamName,status,score');
console.table(list.matches.map((m: any) => ({ partido: `${m.homeTeamName} vs ${m.awayTeamName}`, estado: m.status, marcador: `${m.score.home}-${m.score.away}` })));
