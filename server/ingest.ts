// Idempotent ingestion of an event batch into a match's event log (pure function).

import { validateEvent, type NormalizedEvent } from '../core/validate.ts';
import type { StoredEvent } from '../core/types.ts';

export const MAX_EVENTS_PER_BATCH = 200;
export const MAX_EVENTS_PER_MATCH = 2000;
export const MAX_FUTURE_MS = 5 * 60_000;
export const MAX_AGE_MS = 30 * 24 * 60 * 60_000;

export type EventResult =
  | { id: string | null; status: 'accepted' | 'duplicate' }
  | { id: string | null; status: 'rejected'; reason: string };

export interface IngestOptions {
  matchId: string;
  periods: number;
  /** deviceId stamped on events that do not carry one. */
  deviceId: string;
  /** When true (device keys), events must not claim another deviceId. */
  enforceDeviceId: boolean;
  clockOffsetMs: number;
  nowMs: number;
  /** Sequence number of the last stored event. */
  lastSeq: number;
}

/** Fields that identify an event's content; a resent event must match them exactly. */
const CONTENT_FIELDS = [
  'type',
  'team',
  'playerNumber',
  'playerOutNumber',
  'playerInNumber',
  'text',
  'voidsEventId',
  'period',
  'minutes',
  'clientTimestamp',
  'deviceId',
] as const;

function sameContent(a: Pick<StoredEvent, (typeof CONTENT_FIELDS)[number]>, b: typeof a): boolean {
  return CONTENT_FIELDS.every((field) => a[field] === b[field]);
}

/**
 * Returns the newly accepted events (with seq numbers) and one result per input,
 * in input order. Never mutates `existing`.
 */
export function ingestEvents(
  existing: readonly StoredEvent[],
  rawEvents: readonly unknown[],
  options: IngestOptions,
): { accepted: StoredEvent[]; results: EventResult[] } {
  const known = new Map(existing.map((e) => [e.id, e]));
  const accepted: StoredEvent[] = [];
  const results: EventResult[] = [];
  let seq = options.lastSeq;
  const nowIso = new Date(options.nowMs).toISOString();

  for (const raw of rawEvents) {
    const rawId = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : undefined;
    const echoId = typeof rawId === 'string' ? rawId.toLowerCase().slice(0, 64) : null;
    const reject = (reason: string) => results.push({ id: echoId, status: 'rejected', reason });

    const parsed = validateEvent(raw);
    if (!parsed.ok) {
      reject(parsed.reason);
      continue;
    }
    const input: NormalizedEvent = parsed.value;
    const rawMatchId = (raw as { matchId?: unknown }).matchId;
    if (rawMatchId !== undefined && rawMatchId !== null && String(rawMatchId).toLowerCase() !== options.matchId) {
      reject('match_mismatch');
      continue;
    }
    if (options.enforceDeviceId && input.deviceId !== null && input.deviceId !== options.deviceId) {
      reject('device_mismatch');
      continue;
    }
    const deviceId = input.deviceId ?? options.deviceId;
    const t = Date.parse(input.clientTimestamp) + options.clockOffsetMs;

    const candidate: StoredEvent = {
      id: input.id,
      matchId: options.matchId,
      type: input.type,
      team: input.team,
      playerNumber: input.playerNumber,
      playerOutNumber: input.playerOutNumber,
      playerInNumber: input.playerInNumber,
      text: input.text,
      voidsEventId: input.voidsEventId,
      period: input.period,
      minutes: input.minutes,
      clientTimestamp: input.clientTimestamp,
      matchMinute: input.matchMinute,
      deviceId,
      seq: 0,
      createdAt: nowIso,
      clockOffsetMs: options.clockOffsetMs,
      t,
    };

    const previous = known.get(candidate.id);
    if (previous) {
      if (sameContent(previous, candidate)) results.push({ id: candidate.id, status: 'duplicate' });
      else reject('id_conflict');
      continue;
    }
    if (candidate.period !== null && candidate.period > options.periods) {
      reject('period_out_of_range');
      continue;
    }
    if (t > options.nowMs + MAX_FUTURE_MS) {
      reject('timestamp_in_future');
      continue;
    }
    if (t < options.nowMs - MAX_AGE_MS) {
      reject('timestamp_too_old');
      continue;
    }
    if (candidate.type === 'void') {
      const target = known.get(candidate.voidsEventId!);
      if (target?.type === 'void') {
        reject('cannot_void_a_void');
        continue;
      }
    }
    if (existing.length + accepted.length >= MAX_EVENTS_PER_MATCH) {
      reject('match_event_limit');
      continue;
    }

    candidate.seq = ++seq;
    accepted.push(candidate);
    known.set(candidate.id, candidate);
    results.push({ id: candidate.id, status: 'accepted' });
  }
  return { accepted, results };
}
