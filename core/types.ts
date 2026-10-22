// Shared domain types for ArbitrajeRemoto (web, API and, by contract, the watch app).

export type TeamSide = 'home' | 'away';

export type MatchStatus = 'scheduled' | 'live' | 'halftime' | 'finished';

export const EVENT_TYPES = [
  'goal',
  'own_goal',
  'yellow_card',
  'red_card',
  'substitution',
  'note',
  'period_start',
  'period_pause',
  'period_resume',
  'period_end',
  'added_time',
  'match_end',
  'void',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const CLOCK_EVENT_TYPES: readonly EventType[] = [
  'period_start',
  'period_pause',
  'period_resume',
  'period_end',
  'match_end',
];

export interface Player {
  id: string;
  number: number;
  name?: string | null;
}

export interface Team {
  id: string;
  name: string;
  players: Player[];
  createdAt: string;
  updatedAt: string;
}

export interface Match {
  id: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  /** Snapshot of the team name when the match was created (or last edited). */
  homeTeamName: string;
  awayTeamName: string;
  scheduledAt: string | null;
  periods: number;
  periodMinutes: number;
  tournament: string | null;
  createdAt: string;
  updatedAt: string;
  /** deviceId of the client that created the match (web install id or watch id). */
  createdByDeviceId: string | null;
}

/** Event exactly as a client sends it. Immutable once accepted. */
export interface EventInput {
  id: string;
  matchId?: string;
  type: EventType;
  team?: TeamSide | null;
  playerNumber?: number | null;
  playerOutNumber?: number | null;
  playerInNumber?: number | null;
  text?: string | null;
  voidsEventId?: string | null;
  period?: number | null;
  /** Announced added time in minutes (added_time only). */
  minutes?: number | null;
  /** Real UTC time on the device when the event happened (ISO 8601). */
  clientTimestamp: string;
  /** Minute the client displayed; informational only, the server re-derives it. */
  matchMinute?: number | null;
  deviceId?: string | null;
}

/** Event as stored by the server. */
export interface StoredEvent {
  id: string;
  matchId: string;
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
  deviceId: string;
  /** Server-assigned, strictly increasing per match. Used by `?since=`. */
  seq: number;
  /** Server time when the event was first accepted (ISO 8601). */
  createdAt: string;
  /** Correction applied to clientTimestamp, in ms (0 when the device clock looked right). */
  clockOffsetMs: number;
  /** Effective time used for ordering and the clock: clientTimestamp + clockOffsetMs, epoch ms. */
  t: number;
}

export interface ClockState {
  /** Current period number, or null before kick-off. */
  period: number | null;
  running: boolean;
  /** Played ms in the current period up to `anchorAt` (or in total if not running). */
  elapsedMs: number;
  /** Epoch ms (server-corrected time) when the clock was last started/resumed; null if not running. */
  anchorAt: number | null;
  /** Announced added minutes for the current period, if any. */
  addedMinutes: number | null;
}

export interface PlayerDiscipline {
  team: TeamSide;
  playerNumber: number;
  yellow: number;
  red: boolean;
  /** True when the red card came from a second yellow. */
  secondYellow: boolean;
}

export interface DerivedEvent {
  id: string;
  type: EventType;
  team: TeamSide | null;
  playerNumber: number | null;
  playerOutNumber: number | null;
  playerInNumber: number | null;
  text: string | null;
  period: number | null;
  minutes: number | null;
  t: number;
  /** Period the event happened in, derived from the clock (null before kick-off). */
  atPeriod: number | null;
  /** Football minute label, e.g. "23", "45+2". Null before kick-off. */
  minuteLabel: string | null;
}

export interface Warning {
  eventId: string;
  code: string;
}

export interface MatchState {
  status: MatchStatus;
  score: { home: number; away: number };
  clock: ClockState;
  discipline: PlayerDiscipline[];
  /** Effective (non-voided, non-void) events in time order with derived minutes. */
  timeline: DerivedEvent[];
  voidedEventIds: string[];
  /** Events that were kept but ignored by the clock state machine. */
  warnings: Warning[];
  lastSeq: number;
}
