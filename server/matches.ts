// Matches, events and the public live view.

import { clockOffsetMs } from '../core/clock.ts';
import { deriveState } from '../core/derive.ts';
import type { Match, MatchState, MatchStatus, StoredEvent, Team } from '../core/types.ts';
import { LIMITS, validateDeviceId, validateId, validateIntRange, validateText, validateTimestamp } from '../core/validate.ts';
import { requireOwner, requireOwnerOrDevice, type Ctx, type Principal } from './context.ts';
import { randomToken, safeEqual, sha256 } from './crypto.ts';
import { ApiError, badRequest, gone, notFound, validationError } from './errors.ts';
import { BODY_LIMITS, json, noContent, readJson } from './http.ts';
import { ingestEvents, MAX_EVENTS_PER_BATCH } from './ingest.ts';
import { update } from './store.ts';
import { readTeams } from './teams.ts';

export interface MatchDoc {
  match: Match;
  liveToken: string;
  /** Hash of the normalized creation input, so that resent POST /matches are recognized. */
  creationFingerprint: string;
  events: StoredEvent[];
  lastSeq: number;
  deletedAt: string | null;
}

export interface MatchSummary {
  id: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName: string;
  awayTeamName: string;
  scheduledAt: string | null;
  tournament: string | null;
  periods: number;
  periodMinutes: number;
  status: MatchStatus;
  score: { home: number; away: number };
  createdAt: string;
  updatedAt: string;
  lastSeq: number;
}

interface MatchIndex {
  items: MatchSummary[];
}

export const matchKey = (id: string) => `matches/${id}`;
const INDEX_KEY = 'index/matches';
const SUMMARY_FIELDS = new Set<string>([
  'id',
  'homeTeamId',
  'awayTeamId',
  'homeTeamName',
  'awayTeamName',
  'scheduledAt',
  'tournament',
  'periods',
  'periodMinutes',
  'status',
  'score',
  'createdAt',
  'updatedAt',
  'lastSeq',
]);
const STATUSES = new Set<MatchStatus>(['scheduled', 'live', 'halftime', 'finished']);

export const DEFAULT_NAMES = { home: 'Local', away: 'Visitante' } as const;

/** Compact state for responses (the full timeline is only sent where needed). */
export function compactState(state: MatchState) {
  return {
    status: state.status,
    score: state.score,
    clock: state.clock,
    discipline: state.discipline,
    lastSeq: state.lastSeq,
  };
}

function summarize(doc: MatchDoc, state: MatchState): MatchSummary {
  const m = doc.match;
  return {
    id: m.id,
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    homeTeamName: m.homeTeamName,
    awayTeamName: m.awayTeamName,
    scheduledAt: m.scheduledAt,
    tournament: m.tournament,
    periods: m.periods,
    periodMinutes: m.periodMinutes,
    status: state.status,
    score: state.score,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    lastSeq: doc.lastSeq,
  };
}

/** Keeps the list index in line with a match document (or removes it). */
async function syncIndex(ctx: Ctx, id: string, summary: MatchSummary | null): Promise<void> {
  await update<MatchIndex>(ctx.deps.store, INDEX_KEY, (current) => {
    const items = current?.items ?? [];
    const existing = items.find((item) => item.id === id);
    if (!summary) {
      return existing ? { items: items.filter((item) => item.id !== id) } : undefined;
    }
    if (existing && JSON.stringify(existing) === JSON.stringify(summary)) return undefined;
    return { items: [...items.filter((item) => item.id !== id), summary] };
  });
}

async function loadMatch(ctx: Ctx, id: string): Promise<MatchDoc> {
  const parsed = validateId(id);
  if (!parsed.ok) throw notFound('Match');
  const doc = await ctx.deps.store.get<MatchDoc>(matchKey(parsed.value));
  if (!doc || doc.data.deletedAt) throw notFound('Match');
  return doc.data;
}

function matchView(doc: MatchDoc, principal: Principal) {
  return principal.role === 'owner' ? { ...doc.match, liveToken: doc.liveToken } : doc.match;
}

function compareSummaries(a: MatchSummary, b: MatchSummary): number {
  const sa = a.scheduledAt ?? a.createdAt;
  const sb = b.scheduledAt ?? b.createdAt;
  return sa < sb ? -1 : sa > sb ? 1 : a.id < b.id ? -1 : 1;
}

// --- Input parsing --------------------------------------------------------

interface MatchFields {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  scheduledAt: string | null;
  periods: number | null;
  periodMinutes: number | null;
  tournament: string | null;
}

function must<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw validationError(result.reason);
  return result.value;
}

/** Parses the editable match fields; absent keys are left out of the result. */
function parseMatchFields(body: Record<string, unknown>): Partial<MatchFields> {
  const out: Partial<MatchFields> = {};
  const has = (key: string) => Object.hasOwn(body, key);
  const optionalId = (key: 'homeTeamId' | 'awayTeamId') =>
    body[key] === null ? null : must(validateId(body[key], key));
  if (has('homeTeamId')) out.homeTeamId = optionalId('homeTeamId');
  if (has('awayTeamId')) out.awayTeamId = optionalId('awayTeamId');
  if (has('homeTeamName')) out.homeTeamName = must(validateText(body.homeTeamName, 'homeTeamName', LIMITS.teamName));
  if (has('awayTeamName')) out.awayTeamName = must(validateText(body.awayTeamName, 'awayTeamName', LIMITS.teamName));
  if (has('scheduledAt')) out.scheduledAt = must(validateTimestamp(body.scheduledAt, 'scheduledAt', false));
  if (has('periods')) out.periods = must(validateIntRange(body.periods, 'periods', 1, LIMITS.maxPeriods));
  if (has('periodMinutes')) {
    out.periodMinutes = must(validateIntRange(body.periodMinutes, 'periodMinutes', 1, LIMITS.maxPeriodMinutes));
  }
  if (has('tournament')) out.tournament = must(validateText(body.tournament, 'tournament', LIMITS.tournament));
  return out;
}

function teamName(teams: Team[], id: string | null, given: string | null, side: 'home' | 'away'): string {
  if (given) return given;
  if (id) {
    const team = teams.find((t) => t.id === id);
    if (!team) throw validationError(`unknown_${side}TeamId`);
    return team.name;
  }
  return DEFAULT_NAMES[side];
}

// --- Handlers -------------------------------------------------------------

export async function listMatches(ctx: Ctx): Promise<Response> {
  await requireOwnerOrDevice(ctx);
  const statusParam = ctx.url.searchParams.get('status');
  const fieldsParam = ctx.url.searchParams.get('fields');
  let statuses: Set<string> | null = null;
  if (statusParam) {
    statuses = new Set(statusParam.split(',').map((s) => s.trim()).filter(Boolean));
    for (const s of statuses) if (!STATUSES.has(s as MatchStatus)) throw badRequest(`Unknown status: ${s}`);
  }
  let fields: string[] | null = null;
  if (fieldsParam) {
    fields = [...new Set(['id', ...fieldsParam.split(',').map((f) => f.trim()).filter(Boolean)])];
    for (const f of fields) if (!SUMMARY_FIELDS.has(f)) throw badRequest(`Unknown field: ${f}`);
  }
  const index = await ctx.deps.store.get<MatchIndex>(INDEX_KEY);
  const items = (index?.data.items ?? [])
    .filter((item) => !statuses || statuses.has(item.status))
    .sort(compareSummaries)
    .map((item) =>
      fields ? Object.fromEntries(fields.map((f) => [f, item[f as keyof MatchSummary]])) : item,
    );
  return json({ matches: items, serverTime: new Date(ctx.deps.now()).toISOString() });
}

export async function createMatch(ctx: Ctx): Promise<Response> {
  const principal = await requireOwnerOrDevice(ctx);
  const body = await readJson(ctx.req);
  const id = body.id === undefined || body.id === null ? ctx.deps.uuid() : must(validateId(body.id));
  const fields = parseMatchFields(body);
  const creatorDevice =
    principal.role === 'device' ? principal.deviceId : must(validateDeviceId(body.deviceId, false));

  const teams = await readTeams(ctx);
  const homeTeamId = fields.homeTeamId ?? null;
  const awayTeamId = fields.awayTeamId ?? null;
  if (homeTeamId && homeTeamId === awayTeamId) throw validationError('same_team_both_sides');
  const nowIso = new Date(ctx.deps.now()).toISOString();
  const match: Match = {
    id,
    homeTeamId,
    awayTeamId,
    homeTeamName: teamName(teams, homeTeamId, fields.homeTeamName ?? null, 'home'),
    awayTeamName: teamName(teams, awayTeamId, fields.awayTeamName ?? null, 'away'),
    scheduledAt: fields.scheduledAt ?? null,
    periods: fields.periods ?? 2,
    periodMinutes: fields.periodMinutes ?? 45,
    tournament: fields.tournament ?? null,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdByDeviceId: creatorDevice,
  };
  // Server-chosen values (timestamps) are excluded so that a resent request matches.
  const fingerprint = sha256(
    JSON.stringify([
      match.homeTeamId,
      match.awayTeamId,
      match.homeTeamName,
      match.awayTeamName,
      match.scheduledAt,
      match.periods,
      match.periodMinutes,
      match.tournament,
      match.createdByDeviceId,
    ]),
  );
  const fresh: MatchDoc = {
    match,
    liveToken: randomToken(16),
    creationFingerprint: fingerprint,
    events: [],
    lastSeq: 0,
    deletedAt: null,
  };

  let outcome = 'created' as 'created' | 'duplicate';
  const { value } = await update<MatchDoc>(ctx.deps.store, matchKey(id), (current) => {
    if (!current) {
      outcome = 'created';
      return fresh;
    }
    if (current.deletedAt) throw gone('This match was deleted');
    if (current.creationFingerprint !== fingerprint) {
      throw new ApiError(409, 'ID_CONFLICT', 'A different match already uses this id');
    }
    outcome = 'duplicate';
    return undefined;
  });
  const doc = value!;
  const state = deriveState(doc.match, doc.events);
  await syncIndex(ctx, id, summarize(doc, state));
  return json(
    { match: matchView(doc, principal), state: compactState(state), duplicate: outcome === 'duplicate' },
    outcome === 'created' ? 201 : 200,
  );
}

export async function getMatch(ctx: Ctx): Promise<Response> {
  const principal = await requireOwnerOrDevice(ctx);
  const doc = await loadMatch(ctx, ctx.params.id!);
  const state = deriveState(doc.match, doc.events);
  const include = new Set((ctx.url.searchParams.get('include') ?? '').split(',').filter(Boolean));
  for (const part of include) if (part !== 'events' && part !== 'timeline') throw badRequest(`Unknown include: ${part}`);
  return json({
    match: matchView(doc, principal),
    state: compactState(state),
    ...(include.has('events') ? { events: doc.events } : {}),
    ...(include.has('timeline') ? { timeline: state.timeline, warnings: state.warnings } : {}),
    serverTime: new Date(ctx.deps.now()).toISOString(),
  });
}

export async function patchMatch(ctx: Ctx): Promise<Response> {
  const principal = await requireOwner(ctx);
  const id = must(validateId(ctx.params.id, 'id'));
  const body = await readJson(ctx.req);
  const fields = parseMatchFields(body);
  const rotate = body.rotateLiveToken === true;
  const teams = await readTeams(ctx);
  const nowIso = new Date(ctx.deps.now()).toISOString();

  const { value } = await update<MatchDoc>(ctx.deps.store, matchKey(id), (current) => {
    if (!current || current.deletedAt) throw notFound('Match');
    const m = { ...current.match };
    if (fields.homeTeamId !== undefined) m.homeTeamId = fields.homeTeamId;
    if (fields.awayTeamId !== undefined) m.awayTeamId = fields.awayTeamId;
    if (m.homeTeamId && m.homeTeamId === m.awayTeamId) throw validationError('same_team_both_sides');
    if (fields.homeTeamName !== undefined || fields.homeTeamId !== undefined) {
      m.homeTeamName = teamName(teams, m.homeTeamId, fields.homeTeamName ?? null, 'home');
    }
    if (fields.awayTeamName !== undefined || fields.awayTeamId !== undefined) {
      m.awayTeamName = teamName(teams, m.awayTeamId, fields.awayTeamName ?? null, 'away');
    }
    if (fields.scheduledAt !== undefined) m.scheduledAt = fields.scheduledAt;
    if (fields.tournament !== undefined) m.tournament = fields.tournament;
    if (fields.periodMinutes) m.periodMinutes = fields.periodMinutes;
    if (fields.periods) {
      const highest = current.events.reduce((max, e) => Math.max(max, e.period ?? 0), 0);
      if (fields.periods < highest) throw new ApiError(409, 'CONFLICT', 'Events already use a higher period');
      m.periods = fields.periods;
    }
    m.updatedAt = nowIso;
    return { ...current, match: m, liveToken: rotate ? randomToken(16) : current.liveToken };
  });
  const doc = value!;
  const state = deriveState(doc.match, doc.events);
  await syncIndex(ctx, id, summarize(doc, state));
  return json({ match: matchView(doc, principal), state: compactState(state) });
}

export async function deleteMatch(ctx: Ctx): Promise<Response> {
  await requireOwner(ctx);
  const id = must(validateId(ctx.params.id, 'id'));
  const nowIso = new Date(ctx.deps.now()).toISOString();
  // Tombstone: a watch resending its POST /matches must not bring the match back.
  const { value } = await update<MatchDoc>(ctx.deps.store, matchKey(id), (current) => {
    if (!current || current.deletedAt) throw notFound('Match');
    return { ...current, events: [], deletedAt: nowIso };
  });
  if (value) await syncIndex(ctx, id, null);
  return noContent();
}

export async function postEvents(ctx: Ctx): Promise<Response> {
  const principal = await requireOwnerOrDevice(ctx);
  const id = must(validateId(ctx.params.id, 'id'));
  const body = await readJson(ctx.req, BODY_LIMITS.events);
  if (!Array.isArray(body.events)) throw validationError('missing_events');
  if (body.events.length > MAX_EVENTS_PER_BATCH) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', `At most ${MAX_EVENTS_PER_BATCH} events per batch`);
  }
  const sentAt = must(validateTimestamp(body.sentAt, 'sentAt', false));
  let deviceId: string;
  if (principal.role === 'device') {
    const given = must(validateDeviceId(body.deviceId, false));
    if (given && given !== principal.deviceId) throw new ApiError(403, 'FORBIDDEN', 'deviceId does not match the device key');
    deviceId = principal.deviceId;
  } else {
    deviceId = must(validateDeviceId(body.deviceId, true)) as string;
  }

  const now = ctx.deps.now();
  const offset = clockOffsetMs(now, sentAt ? Date.parse(sentAt) : null);
  let results: ReturnType<typeof ingestEvents>['results'] = [];

  const { value } = await update<MatchDoc>(ctx.deps.store, matchKey(id), (current) => {
    if (!current) throw notFound('Match');
    if (current.deletedAt) throw gone('This match was deleted');
    const outcome = ingestEvents(current.events, body.events as unknown[], {
      matchId: id,
      periods: current.match.periods,
      deviceId,
      enforceDeviceId: principal.role === 'device',
      clockOffsetMs: offset,
      nowMs: now,
      lastSeq: current.lastSeq,
    });
    results = outcome.results;
    if (outcome.accepted.length === 0) return undefined;
    return {
      ...current,
      events: [...current.events, ...outcome.accepted],
      lastSeq: current.lastSeq + outcome.accepted.length,
      match: { ...current.match, updatedAt: new Date(now).toISOString() },
    };
  });
  const doc = value!;
  const state = deriveState(doc.match, doc.events);
  // Also runs when nothing new was accepted, so a retry repairs a missed index update.
  await syncIndex(ctx, id, summarize(doc, state));
  return json({
    results,
    state: compactState(state),
    clockOffsetMs: offset,
    serverTime: new Date(now).toISOString(),
  });
}

export async function getEvents(ctx: Ctx): Promise<Response> {
  await requireOwnerOrDevice(ctx);
  const doc = await loadMatch(ctx, ctx.params.id!);
  const sinceParam = ctx.url.searchParams.get('since');
  const since = sinceParam === null ? 0 : Number(sinceParam);
  if (!Number.isInteger(since) || since < 0) throw badRequest('since must be a non-negative integer (a seq number)');
  const state = deriveState(doc.match, doc.events);
  return json({
    events: doc.events.filter((e) => e.seq > since).sort((a, b) => a.seq - b.seq),
    lastSeq: doc.lastSeq,
    state: compactState(state),
    serverTime: new Date(ctx.deps.now()).toISOString(),
  });
}

/** Public, read-only. Only teams, score, clock and non-private events. */
export async function getLive(ctx: Ctx): Promise<Response> {
  const token = ctx.url.searchParams.get('token') ?? '';
  let doc: MatchDoc;
  try {
    doc = await loadMatch(ctx, ctx.params.id!);
  } catch {
    throw notFound('Match');
  }
  if (!token || !safeEqual(token, doc.liveToken)) throw notFound('Match');

  const etag = `W/"${doc.lastSeq}-${sha256(doc.match.updatedAt).slice(0, 12)}"`;
  const headers = { ETag: etag, 'Cache-Control': 'no-cache' };
  if (ctx.req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  const state = deriveState(doc.match, doc.events);
  const m = doc.match;
  return json(
    {
      match: {
        homeTeamName: m.homeTeamName,
        awayTeamName: m.awayTeamName,
        tournament: m.tournament,
        scheduledAt: m.scheduledAt,
        periods: m.periods,
        periodMinutes: m.periodMinutes,
      },
      state: { status: state.status, score: state.score, clock: state.clock, lastSeq: state.lastSeq },
      timeline: state.timeline
        .filter((e) => e.type !== 'note')
        .map(({ id, type, team, playerNumber, playerOutNumber, playerInNumber, period, minutes, atPeriod, minuteLabel }) => ({
          id,
          type,
          team,
          playerNumber,
          playerOutNumber,
          playerInNumber,
          period,
          minutes,
          atPeriod,
          minuteLabel,
        })),
      serverTime: new Date(ctx.deps.now()).toISOString(),
    },
    200,
    headers,
  );
}
