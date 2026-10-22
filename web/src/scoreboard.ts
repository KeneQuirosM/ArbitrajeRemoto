// Pure helpers for the live scoreboard screen.

import type { DerivedEvent, MatchState } from '../../core/types.ts';
import type { NewEvent } from './repo.ts';

export type ClockAction =
  | { kind: 'start'; period: number }
  | { kind: 'pause'; period: number }
  | { kind: 'resume'; period: number }
  | { kind: 'end'; period: number }
  | { kind: 'finish' };

/** Main clock button and the less frequent ones, for the current state. */
export function clockActions(state: MatchState, periods: number): { primary: ClockAction | null; secondary: ClockAction[] } {
  const period = state.clock.period;
  switch (state.status) {
    case 'scheduled':
      return { primary: { kind: 'start', period: 1 }, secondary: [] };
    case 'live':
      return state.clock.running
        ? { primary: { kind: 'pause', period: period! }, secondary: [{ kind: 'end', period: period! }, { kind: 'finish' }] }
        : { primary: { kind: 'resume', period: period! }, secondary: [{ kind: 'end', period: period! }, { kind: 'finish' }] };
    case 'halftime':
      return period! < periods
        ? { primary: { kind: 'start', period: period! + 1 }, secondary: [{ kind: 'finish' }] }
        : { primary: null, secondary: [{ kind: 'finish' }] };
    case 'finished':
      return { primary: null, secondary: [] };
  }
}

export function clockActionEvent(action: ClockAction): NewEvent {
  switch (action.kind) {
    case 'start':
      return { type: 'period_start', period: action.period };
    case 'pause':
      return { type: 'period_pause', period: action.period };
    case 'resume':
      return { type: 'period_resume', period: action.period };
    case 'end':
      return { type: 'period_end', period: action.period };
    case 'finish':
      return { type: 'match_end' };
  }
}

/** Latest events first, for the on-screen timeline. */
export function newestFirst(timeline: readonly DerivedEvent[]): DerivedEvent[] {
  return [...timeline].reverse();
}

/** Players already sent off cannot get more cards in the picker (they stay selectable by typing). */
export function sentOff(state: MatchState, team: 'home' | 'away'): Set<number> {
  return new Set(state.discipline.filter((d) => d.team === team && d.red).map((d) => d.playerNumber));
}
