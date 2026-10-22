import { describe, expect, it } from 'vitest';
import { MIN, ev, shuffle } from '../test/helpers.ts';
import { deriveState } from './derive.ts';

const rules = { periods: 2, periodMinutes: 45 };
const K = Date.parse('2026-10-25T16:00:00Z');

describe('deriveState: score and cards', () => {
  it('starts scheduled at 0-0', () => {
    const s = deriveState(rules, []);
    expect(s.status).toBe('scheduled');
    expect(s.score).toEqual({ home: 0, away: 0 });
    expect(s.clock.period).toBeNull();
  });

  it('counts goals and gives own goals to the opponent', () => {
    const s = deriveState(rules, [
      ev('period_start', K, { period: 1 }),
      ev('goal', K + 10 * MIN, { team: 'home', playerNumber: 9 }),
      ev('own_goal', K + 20 * MIN, { team: 'home', playerNumber: 4 }),
      ev('goal', K + 30 * MIN, { team: 'away' }),
    ]);
    expect(s.score).toEqual({ home: 1, away: 2 });
    expect(s.status).toBe('live');
  });

  it('turns a second yellow into a red', () => {
    const s = deriveState(rules, [
      ev('period_start', K, { period: 1 }),
      ev('yellow_card', K + MIN, { team: 'away', playerNumber: 5 }),
      ev('yellow_card', K + 2 * MIN, { team: 'away', playerNumber: 5 }),
      ev('red_card', K + 3 * MIN, { team: 'home', playerNumber: 3 }),
      ev('yellow_card', K + 4 * MIN, { team: 'home' }),
    ]);
    expect(s.discipline).toEqual([
      { team: 'home', playerNumber: 3, yellow: 0, red: true, secondYellow: false },
      { team: 'away', playerNumber: 5, yellow: 2, red: true, secondYellow: true },
    ]);
  });
});

describe('deriveState: void (undo)', () => {
  it('removes the voided event from score and timeline', () => {
    const goal = ev('goal', K + MIN, { team: 'home', playerNumber: 10 });
    const s = deriveState(rules, [
      ev('period_start', K, { period: 1 }),
      goal,
      ev('void', K + 2 * MIN, { voidsEventId: goal.id }),
    ]);
    expect(s.score.home).toBe(0);
    expect(s.voidedEventIds).toEqual([goal.id]);
    expect(s.timeline.map((e) => e.type)).toEqual(['period_start']);
  });

  it('ignores a void that targets another void', () => {
    const goal = ev('goal', K + MIN, { team: 'home' });
    const undo = ev('void', K + 2 * MIN, { voidsEventId: goal.id });
    const redo = ev('void', K + 3 * MIN, { voidsEventId: undo.id });
    const s = deriveState(rules, [ev('period_start', K, { period: 1 }), goal, undo, redo]);
    expect(s.score.home).toBe(0);
    expect(s.warnings).toContainEqual({ eventId: redo.id, code: 'void_targets_void' });
  });

  it('applies a void whose target arrives later', () => {
    const goal = ev('goal', K + MIN, { team: 'away' });
    const undo = ev('void', K + 2 * MIN, { voidsEventId: goal.id });
    const before = deriveState(rules, [undo]);
    expect(before.warnings).toEqual([{ eventId: undo.id, code: 'void_target_missing' }]);
    expect(deriveState(rules, [undo, goal]).score.away).toBe(0);
  });

  it('can undo a kick-off', () => {
    const start = ev('period_start', K, { period: 1 });
    const s = deriveState(rules, [start, ev('void', K + 5000, { voidsEventId: start.id })]);
    expect(s.status).toBe('scheduled');
  });
});

describe('deriveState: clock from timestamps', () => {
  const firstHalf = () => [
    ev('period_start', K, { period: 1 }),
    ev('period_pause', K + 10 * MIN, { period: 1 }),
    ev('period_resume', K + 13 * MIN, { period: 1 }),
  ];

  it('excludes paused time', () => {
    const s = deriveState(rules, firstHalf());
    expect(s.clock).toEqual({ period: 1, running: true, elapsedMs: 10 * MIN, anchorAt: K + 13 * MIN, addedMinutes: null });
    // A goal 20 real minutes after kick-off with 3 paused minutes is in the 18th minute.
    const goal = ev('goal', K + 20 * MIN, { team: 'home' });
    const s2 = deriveState(rules, [...firstHalf(), goal]);
    expect(s2.timeline.find((e) => e.id === goal.id)?.minuteLabel).toBe('18');
  });

  it('goes to halftime, then second half starts at 46', () => {
    const goal = ev('goal', K + 70 * MIN + 30_000, { team: 'away' });
    const s = deriveState(rules, [
      ...firstHalf(),
      ev('added_time', K + 46 * MIN, { minutes: 2 }),
      ev('period_end', K + 50 * MIN, { period: 1 }),
      ev('period_start', K + 65 * MIN, { period: 2 }),
      goal,
    ]);
    expect(s.status).toBe('live');
    expect(s.clock.period).toBe(2);
    expect(s.timeline.find((e) => e.type === 'period_end')?.minuteLabel).toBe('45+3');
    expect(s.timeline.find((e) => e.id === goal.id)?.minuteLabel).toBe('51');
  });

  it('reports halftime and the added time of the period', () => {
    const s = deriveState(rules, [
      ...firstHalf(),
      ev('added_time', K + 46 * MIN, { minutes: 2 }),
    ]);
    expect(s.clock.addedMinutes).toBe(2);
    const s2 = deriveState(rules, [...firstHalf(), ev('period_end', K + 50 * MIN, { period: 1 })]);
    expect(s2.status).toBe('halftime');
    expect(s2.clock).toMatchObject({ running: false, elapsedMs: 47 * MIN });
  });

  it('finishes after the last period or on match_end', () => {
    const base = [ev('period_start', K, { period: 1 }), ev('period_end', K + 45 * MIN, { period: 1 })];
    const finished = deriveState(rules, [
      ...base,
      ev('period_start', K + 60 * MIN, { period: 2 }),
      ev('period_end', K + 106 * MIN, { period: 2 }),
    ]);
    expect(finished.status).toBe('finished');
    const abandoned = deriveState(rules, [...base, ev('period_start', K + 60 * MIN, { period: 2 }), ev('match_end', K + 70 * MIN)]);
    expect(abandoned.status).toBe('finished');
    expect(abandoned.clock).toMatchObject({ period: 2, running: false, elapsedMs: 10 * MIN });
  });

  it('keeps but ignores impossible clock transitions', () => {
    const resume = ev('period_resume', K + MIN);
    const start2 = ev('period_start', K + 2 * MIN, { period: 2 });
    const s = deriveState(rules, [ev('period_start', K, { period: 1 }), resume, start2]);
    expect(s.clock).toMatchObject({ period: 1, running: true, anchorAt: K });
    expect(s.warnings.map((w) => w.code).sort()).toEqual(['invalid_period_start', 'invalid_resume']);
  });

  it('does not start a period beyond the configured number', () => {
    const one = { periods: 1, periodMinutes: 40 };
    const s = deriveState(one, [
      ev('period_start', K, { period: 1 }),
      ev('period_end', K + 40 * MIN, { period: 1 }),
      ev('period_start', K + 50 * MIN, { period: 2 }),
    ]);
    expect(s.status).toBe('finished');
  });
});

describe('deriveState: order independence', () => {
  it('gives the same state for any arrival order', () => {
    const goal = ev('goal', K + 5 * MIN, { team: 'home', playerNumber: 7 });
    const events = [
      ev('period_start', K, { period: 1 }),
      goal,
      ev('yellow_card', K + 6 * MIN, { team: 'away', playerNumber: 8 }),
      ev('void', K + 7 * MIN, { voidsEventId: goal.id }),
      ev('substitution', K + 8 * MIN, { team: 'away', playerOutNumber: 8, playerInNumber: 14 }),
      ev('period_pause', K + 9 * MIN, { period: 1 }),
      ev('period_resume', K + 10 * MIN, { period: 1 }),
      ev('goal', K + 20 * MIN, { team: 'away', playerNumber: 14 }),
      ev('note', K + 21 * MIN, { text: 'Lesión del 3' }),
      ev('period_end', K + 47 * MIN, { period: 1 }),
    ];
    const expected = deriveState(rules, events);
    for (let seed = 1; seed <= 20; seed++) {
      expect(deriveState(rules, shuffle(events, seed))).toEqual(expected);
    }
    expect(expected.score).toEqual({ home: 0, away: 1 });
  });
});
