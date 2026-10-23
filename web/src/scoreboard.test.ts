import { describe, expect, it } from 'vitest';
import { deriveState } from '../../core/derive.ts';
import { MIN, ev } from '../../test/helpers.ts';
import { clockActionEvent, clockActions, sentOff } from './scoreboard.ts';

const rules = { periods: 2, periodMinutes: 45 };
const K = Date.parse('2026-10-25T16:00:00Z');

describe('clockActions', () => {
  it('offers the right main button in each phase', () => {
    const at = (...events: ReturnType<typeof ev>[]) => clockActions(deriveState(rules, events), 2);
    expect(at().primary).toEqual({ kind: 'start', period: 1 });
    const start = ev('period_start', K, { period: 1 });
    expect(at(start).primary).toEqual({ kind: 'pause', period: 1 });
    expect(at(start).secondary).toEqual([{ kind: 'end', period: 1 }, { kind: 'finish' }]);
    const pause = ev('period_pause', K + MIN, { period: 1 });
    expect(at(start, pause).primary).toEqual({ kind: 'resume', period: 1 });
    const end = ev('period_end', K + 46 * MIN, { period: 1 });
    expect(at(start, end).primary).toEqual({ kind: 'start', period: 2 });
    const start2 = ev('period_start', K + 60 * MIN, { period: 2 });
    const end2 = ev('period_end', K + 106 * MIN, { period: 2 });
    expect(at(start, end, start2, end2)).toEqual({ primary: null, secondary: [] });
  });

  it('maps actions to events', () => {
    expect(clockActionEvent({ kind: 'start', period: 2 })).toEqual({ type: 'period_start', period: 2 });
    expect(clockActionEvent({ kind: 'finish' })).toEqual({ type: 'match_end' });
  });
});

describe('sentOff', () => {
  it('lists players with a red card (including two yellows)', () => {
    const state = deriveState(rules, [
      ev('period_start', K, { period: 1 }),
      ev('yellow_card', K + MIN, { team: 'home', playerNumber: 5 }),
      ev('yellow_card', K + 2 * MIN, { team: 'home', playerNumber: 5 }),
      ev('red_card', K + 3 * MIN, { team: 'away', playerNumber: 7 }),
    ]);
    expect([...sentOff(state, 'home')]).toEqual([5]);
    expect([...sentOff(state, 'away')]).toEqual([7]);
  });
});
