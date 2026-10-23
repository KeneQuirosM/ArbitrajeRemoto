// Pure derivation of the match state from its immutable event log.
// Same events in any arrival order => same state.

import { minuteLabel } from './clock.ts';
import type {
  ClockState,
  DerivedEvent,
  Match,
  MatchState,
  MatchStatus,
  PlayerDiscipline,
  StoredEvent,
  TeamSide,
  Warning,
} from './types.ts';

type Phase = 'pre' | 'running' | 'paused' | 'break' | 'ended';

const PHASE_STATUS: Record<Phase, MatchStatus> = {
  pre: 'scheduled',
  running: 'live',
  paused: 'live',
  break: 'halftime',
  ended: 'finished',
};

export type MatchRules = Pick<Match, 'periods' | 'periodMinutes'>;

/** Deterministic order: effective time, then id (ties are practically impossible). */
export function compareEvents(a: Pick<StoredEvent, 't' | 'id'>, b: Pick<StoredEvent, 't' | 'id'>): number {
  if (a.t !== b.t) return a.t - b.t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const opponent = (side: TeamSide): TeamSide => (side === 'home' ? 'away' : 'home');

/** Ids voided by valid `void` events. A void can never target another void. */
export function voidedIds(events: readonly StoredEvent[]): { voided: Set<string>; warnings: Warning[] } {
  const byId = new Map(events.map((e) => [e.id, e]));
  const voided = new Set<string>();
  const warnings: Warning[] = [];
  for (const e of events) {
    if (e.type !== 'void' || !e.voidsEventId) continue;
    const target = byId.get(e.voidsEventId);
    if (!target) {
      // The target may still be in some device's queue; it is applied once it arrives.
      warnings.push({ eventId: e.id, code: 'void_target_missing' });
    } else if (target.type === 'void') {
      warnings.push({ eventId: e.id, code: 'void_targets_void' });
    } else {
      voided.add(target.id);
    }
  }
  return { voided, warnings };
}

export function deriveState(rules: MatchRules, events: readonly StoredEvent[]): MatchState {
  const { voided, warnings } = voidedIds(events);
  const effective = events.filter((e) => e.type !== 'void' && !voided.has(e.id)).sort(compareEvents);

  let phase: Phase = 'pre';
  let period: number | null = null;
  let elapsedMs = 0;
  let anchorAt: number | null = null;
  const added = new Map<number, number>();
  const score = { home: 0, away: 0 };
  const discipline = new Map<string, PlayerDiscipline>();
  const timeline: DerivedEvent[] = [];

  const elapsedAtT = (t: number) => (phase === 'running' && anchorAt !== null ? elapsedMs + Math.max(0, t - anchorAt) : elapsedMs);
  const warn = (e: StoredEvent, code: string) => warnings.push({ eventId: e.id, code });
  const stopClock = (t: number) => {
    elapsedMs = elapsedAtT(t);
    anchorAt = null;
  };

  for (const e of effective) {
    // Minute of the event, measured before any clock transition it causes.
    let atPeriod = period;
    let atElapsed = elapsedAtT(e.t);

    switch (e.type) {
      case 'period_start':
        if ((phase === 'pre' && e.period === 1) || (phase === 'break' && period !== null && e.period === period + 1)) {
          if (e.period! > rules.periods) {
            warn(e, 'period_out_of_range');
            break;
          }
          phase = 'running';
          period = e.period;
          elapsedMs = 0;
          anchorAt = e.t;
          atPeriod = period;
          atElapsed = 0;
        } else {
          warn(e, 'invalid_period_start');
        }
        break;
      case 'period_pause':
        if (phase === 'running') {
          stopClock(e.t);
          phase = 'paused';
        } else warn(e, 'invalid_pause');
        break;
      case 'period_resume':
        if (phase === 'paused') {
          phase = 'running';
          anchorAt = e.t;
        } else warn(e, 'invalid_resume');
        break;
      case 'period_end':
        if ((phase === 'running' || phase === 'paused') && e.period === period) {
          stopClock(e.t);
          phase = period! >= rules.periods ? 'ended' : 'break';
        } else warn(e, 'invalid_period_end');
        break;
      case 'match_end':
        if (phase === 'ended') warn(e, 'already_finished');
        else {
          if (phase === 'running' || phase === 'paused') stopClock(e.t);
          phase = 'ended';
        }
        break;
      case 'added_time': {
        const target = e.period ?? period;
        if (target === null) warn(e, 'added_time_before_kickoff');
        else added.set(target, e.minutes ?? 0);
        break;
      }
      case 'goal':
        score[e.team!] += 1;
        break;
      case 'own_goal':
        // `team` is the side of the player who scored into their own net.
        score[opponent(e.team!)] += 1;
        break;
      case 'yellow_card':
      case 'red_card': {
        if (e.playerNumber === null) break;
        const key = `${e.team}:${e.playerNumber}`;
        const entry = discipline.get(key) ?? {
          team: e.team!,
          playerNumber: e.playerNumber,
          yellow: 0,
          red: false,
          secondYellow: false,
        };
        if (e.type === 'yellow_card') {
          entry.yellow += 1;
          if (entry.yellow >= 2 && !entry.red) {
            entry.red = true;
            entry.secondYellow = true;
          }
        } else {
          entry.red = true;
        }
        discipline.set(key, entry);
        break;
      }
      case 'substitution':
      case 'note':
      case 'void':
        break;
    }

    timeline.push({
      id: e.id,
      type: e.type,
      team: e.team,
      playerNumber: e.playerNumber,
      playerOutNumber: e.playerOutNumber,
      playerInNumber: e.playerInNumber,
      text: e.text,
      period: e.period,
      minutes: e.minutes,
      t: e.t,
      atPeriod,
      minuteLabel: atPeriod === null ? null : minuteLabel(atPeriod, atElapsed, rules.periodMinutes),
    });
  }

  const clock: ClockState = {
    period,
    running: phase === 'running',
    elapsedMs,
    anchorAt: phase === 'running' ? anchorAt : null,
    addedMinutes: period === null ? null : (added.get(period) ?? null),
  };

  return {
    status: PHASE_STATUS[phase],
    score,
    clock,
    discipline: [...discipline.values()].sort((a, b) =>
      a.team === b.team ? a.playerNumber - b.playerNumber : a.team === 'home' ? -1 : 1,
    ),
    timeline,
    voidedEventIds: [...voided].sort(),
    warnings: warnings.sort((a, b) => (a.eventId === b.eventId ? (a.code < b.code ? -1 : 1) : a.eventId < b.eventId ? -1 : 1)),
    lastSeq: events.reduce((max, e) => Math.max(max, e.seq), 0),
  };
}
