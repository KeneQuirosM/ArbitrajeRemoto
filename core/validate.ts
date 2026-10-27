// Input validation and sanitizing shared by the web and the API.
// Every validator returns either { ok: true, value } with a normalized value
// or { ok: false, reason } with a stable, machine-readable reason.

import { EVENT_TYPES, type EventInput, type EventType, type Player, type TeamSide } from './types.ts';

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export const LIMITS = {
  teamName: 60,
  playerName: 60,
  tournament: 80,
  noteText: 500,
  deviceId: 64,
  deviceName: 40,
  playersPerTeam: 60,
  minPlayerNumber: 1,
  // Futsal and amateur leagues use numbers like 108
  maxPlayerNumber: 999,
  maxPeriods: 4,
  maxPeriodMinutes: 60,
  maxAddedMinutes: 30,
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9._-]+$/;
// ISO 8601 with an explicit zone ("Z" or "+hh:mm") so devices cannot send ambiguous local times.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
// C0/C1 control characters except tab and newline.
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(reason: string): Result<T> => ({ ok: false, reason });

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.toLowerCase());
}

export function validateId(value: unknown, field = 'id'): Result<string> {
  if (typeof value !== 'string' || !UUID_RE.test(value.toLowerCase())) return fail(`invalid_${field}`);
  return ok(value.toLowerCase());
}

/** Trims, normalizes Unicode and strips control characters. Newlines are kept only when allowed. */
export function cleanText(value: string, allowNewlines = false): string {
  let text = value.normalize('NFC').replace(CONTROL_RE, '');
  text = allowNewlines ? text.replace(/\t/g, ' ') : text.replace(/[\t\n]+/g, ' ');
  return text.trim();
}

export function validateText(
  value: unknown,
  field: string,
  max: number,
  { required = false, allowNewlines = false } = {},
): Result<string | null> {
  if (value === undefined || value === null || value === '') {
    return required ? fail(`missing_${field}`) : ok(null);
  }
  if (typeof value !== 'string') return fail(`invalid_${field}`);
  const text = cleanText(value, allowNewlines);
  if (text.length === 0) return required ? fail(`missing_${field}`) : ok(null);
  if (text.length > max) return fail(`${field}_too_long`);
  return ok(text);
}

export function validatePlayerNumber(value: unknown, field = 'playerNumber', required = false): Result<number | null> {
  if (value === undefined || value === null) return required ? fail(`missing_${field}`) : ok(null);
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < LIMITS.minPlayerNumber ||
    value > LIMITS.maxPlayerNumber
  ) {
    return fail(`invalid_${field}`);
  }
  return ok(value);
}

export function validateIntRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
  required = false,
): Result<number | null> {
  if (value === undefined || value === null) return required ? fail(`missing_${field}`) : ok(null);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return fail(`invalid_${field}`);
  }
  return ok(value);
}

/** Parses an ISO 8601 timestamp with explicit zone; returns it normalized to UTC ("...Z"). */
export function validateTimestamp(value: unknown, field: string, required = true): Result<string | null> {
  if (value === undefined || value === null) return required ? fail(`missing_${field}`) : ok(null);
  if (typeof value !== 'string' || !ISO_RE.test(value)) return fail(`invalid_${field}`);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return fail(`invalid_${field}`);
  return ok(new Date(ms).toISOString());
}

export function validateDeviceId(value: unknown, required = true): Result<string | null> {
  if (value === undefined || value === null || value === '') return required ? fail('missing_deviceId') : ok(null);
  if (typeof value !== 'string' || value.length > LIMITS.deviceId || !DEVICE_ID_RE.test(value)) {
    return fail('invalid_deviceId');
  }
  return ok(value);
}

export function validateTeamSide(value: unknown, required: boolean): Result<TeamSide | null> {
  if (value === undefined || value === null) return required ? fail('missing_team') : ok(null);
  if (value !== 'home' && value !== 'away') return fail('invalid_team');
  return ok(value);
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

export interface NormalizedEvent {
  id: string;
  type: EventType;
  team: TeamSide | null;
  playerNumber: number | null;
  playerOutNumber: number | null;
  playerInNumber: number | null;
  text: string | null;
  voidsEventId: string | null;
  period: number | null;
  minutes: number | null;
  clientTimestamp: string;
  matchMinute: number | null;
  deviceId: string | null;
}

/**
 * Validates one event from a client. Fields that do not apply to the event type
 * are dropped (set to null) so that equal events always normalize to equal values.
 */
export function validateEvent(raw: unknown): Result<NormalizedEvent> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('invalid_event');
  const input = raw as Partial<Record<keyof EventInput, unknown>>;

  const id = validateId(input.id);
  if (!id.ok) return id;
  if (!isEventType(input.type)) return fail('invalid_type');
  const type = input.type;

  const ts = validateTimestamp(input.clientTimestamp, 'clientTimestamp');
  if (!ts.ok) return ts;
  const device = validateDeviceId(input.deviceId, false);
  if (!device.ok) return device;
  const minute = validateIntRange(input.matchMinute, 'matchMinute', 0, 400);
  if (!minute.ok) return minute;

  const event: NormalizedEvent = {
    id: id.value,
    type,
    team: null,
    playerNumber: null,
    playerOutNumber: null,
    playerInNumber: null,
    text: null,
    voidsEventId: null,
    period: null,
    minutes: null,
    clientTimestamp: ts.value as string,
    matchMinute: minute.value,
    deviceId: device.value,
  };

  switch (type) {
    case 'goal':
    case 'own_goal':
    case 'yellow_card':
    case 'red_card': {
      const team = validateTeamSide(input.team, true);
      if (!team.ok) return team;
      const num = validatePlayerNumber(input.playerNumber);
      if (!num.ok) return num;
      event.team = team.value;
      event.playerNumber = num.value;
      break;
    }
    case 'substitution': {
      const team = validateTeamSide(input.team, true);
      if (!team.ok) return team;
      const out = validatePlayerNumber(input.playerOutNumber, 'playerOutNumber', true);
      if (!out.ok) return out;
      const inn = validatePlayerNumber(input.playerInNumber, 'playerInNumber', true);
      if (!inn.ok) return inn;
      if (out.value === inn.value) return fail('same_player_in_and_out');
      event.team = team.value;
      event.playerOutNumber = out.value;
      event.playerInNumber = inn.value;
      break;
    }
    case 'note': {
      const text = validateText(input.text, 'text', LIMITS.noteText, { required: true, allowNewlines: true });
      if (!text.ok) return text;
      const team = validateTeamSide(input.team, false);
      if (!team.ok) return team;
      const num = validatePlayerNumber(input.playerNumber);
      if (!num.ok) return num;
      event.text = text.value;
      event.team = team.value;
      event.playerNumber = num.value;
      break;
    }
    case 'period_start':
    case 'period_end': {
      const period = validateIntRange(input.period, 'period', 1, LIMITS.maxPeriods, true);
      if (!period.ok) return period;
      event.period = period.value;
      break;
    }
    case 'period_pause':
    case 'period_resume': {
      const period = validateIntRange(input.period, 'period', 1, LIMITS.maxPeriods);
      if (!period.ok) return period;
      event.period = period.value;
      break;
    }
    case 'added_time': {
      const minutes = validateIntRange(input.minutes, 'minutes', 0, LIMITS.maxAddedMinutes, true);
      if (!minutes.ok) return minutes;
      const period = validateIntRange(input.period, 'period', 1, LIMITS.maxPeriods);
      if (!period.ok) return period;
      event.minutes = minutes.value;
      event.period = period.value;
      break;
    }
    case 'match_end':
      break;
    case 'void': {
      const target = validateId(input.voidsEventId, 'voidsEventId');
      if (!target.ok) return target;
      if (target.value === event.id) return fail('cannot_void_itself');
      event.voidsEventId = target.value;
      break;
    }
  }
  return ok(event);
}

export function validatePlayers(raw: unknown, makeId: () => string): Result<Player[]> {
  if (raw === undefined || raw === null) return ok([]);
  if (!Array.isArray(raw)) return fail('invalid_players');
  if (raw.length > LIMITS.playersPerTeam) return fail('too_many_players');
  const seenNumbers = new Set<number>();
  const seenIds = new Set<string>();
  const players: Player[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return fail('invalid_player');
    const p = item as Record<string, unknown>;
    const num = validatePlayerNumber(p.number, 'number', true);
    if (!num.ok) return num;
    if (seenNumbers.has(num.value as number)) return fail('duplicate_player_number');
    seenNumbers.add(num.value as number);
    const name = validateText(p.name, 'playerName', LIMITS.playerName);
    if (!name.ok) return name;
    let id: string;
    if (p.id === undefined || p.id === null) {
      id = makeId();
    } else {
      const parsed = validateId(p.id, 'playerId');
      if (!parsed.ok) return parsed;
      id = parsed.value;
    }
    if (seenIds.has(id)) return fail('duplicate_player_id');
    seenIds.add(id);
    players.push({ id, number: num.value as number, name: name.value });
  }
  players.sort((a, b) => a.number - b.number);
  return ok(players);
}
