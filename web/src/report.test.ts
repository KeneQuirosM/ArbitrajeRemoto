import { describe, expect, it } from 'vitest';
import { deriveState } from '../../core/derive.ts';
import { MIN, ev } from '../../test/helpers.ts';
import { buildReport, reportText } from './report.ts';

const rules = { periods: 2, periodMinutes: 45 };
const K = Date.parse('2026-10-25T16:00:00Z');

const LABELS = {
  score: 'Marcador',
  unfinished: 'Sin terminar',
  goals: 'Goles',
  cards: 'Tarjetas',
  subs: 'Cambios',
  notes: 'Notas',
  ownGoal: 'en propia',
  yellow: 'Amarilla',
  red: 'Roja',
  secondYellow: 'Segunda amarilla',
  noNumber: 'sin dorsal',
};

function fullMatch() {
  return [
    ev('period_start', K, { period: 1 }),
    ev('goal', K + 12 * MIN, { team: 'home', playerNumber: 9 }),
    ev('yellow_card', K + 20 * MIN, { team: 'away', playerNumber: 4 }),
    ev('note', K + 21 * MIN, { text: 'Banquillo protesta', team: 'away' }),
    ev('added_time', K + 44 * MIN, { minutes: 2, period: 1 }),
    ev('period_end', K + 47 * MIN, { period: 1 }),
    ev('period_start', K + 60 * MIN, { period: 2 }),
    ev('own_goal', K + 70 * MIN, { team: 'home', playerNumber: 5 }),
    ev('substitution', K + 75 * MIN, { team: 'away', playerOutNumber: 10, playerInNumber: 14 }),
    ev('yellow_card', K + 80 * MIN, { team: 'away', playerNumber: 4 }),
    ev('goal', K + 90 * MIN, { team: 'home', playerNumber: 11 }),
    ev('period_end', K + 106 * MIN, { period: 2 }),
  ];
}

describe('buildReport', () => {
  it('summarizes goals, cards, substitutions, notes and periods', () => {
    const state = deriveState(rules, fullMatch());
    const report = buildReport(rules, state, { home: [{ id: 'p9', number: 9, name: 'Ana' }] });

    expect(report.finished).toBe(true);
    expect(report.score).toEqual({ home: 2, away: 1 });
    expect(report.goals.map((g) => [g.minute, g.scoringTeam, g.playerTeam, g.playerNumber, g.playerName, g.ownGoal])).toEqual([
      ['13', 'home', 'home', 9, 'Ana', false],
      ['56', 'away', 'home', 5, null, true],
      ['76', 'home', 'home', 11, null, false],
    ]);
    expect(report.cards.map((c) => [c.minute, c.team, c.playerNumber, c.kind])).toEqual([
      ['21', 'away', 4, 'yellow'],
      ['66', 'away', 4, 'secondYellow'],
    ]);
    expect(report.subs).toEqual([expect.objectContaining({ team: 'away', outNumber: 10, inNumber: 14 })]);
    expect(report.notes).toEqual([expect.objectContaining({ text: 'Banquillo protesta', team: 'away' })]);
    expect(report.periods).toEqual([
      { period: 1, startedAt: K, endedAt: K + 47 * MIN, addedMinutes: 2, score: { home: 1, away: 0 } },
      { period: 2, startedAt: K + 60 * MIN, endedAt: K + 106 * MIN, addedMinutes: null, score: { home: 2, away: 1 } },
    ]);
    expect(report.kickOffAt).toBe(K);
  });

  it('leaves out undone events and reports an unfinished match', () => {
    const goal = ev('goal', K + 5 * MIN, { team: 'away', playerNumber: 7 });
    const state = deriveState(rules, [ev('period_start', K, { period: 1 }), goal, ev('void', K + 6 * MIN, { voidsEventId: goal.id })]);
    const report = buildReport(rules, state);
    expect(report.goals).toEqual([]);
    expect(report.finished).toBe(false);
    expect(report.periods[0]!.score).toEqual({ home: 0, away: 0 });
  });

  it('carries the score into a period without goals', () => {
    const state = deriveState(rules, [
      ev('period_start', K, { period: 1 }),
      ev('goal', K + 10 * MIN, { team: 'away', playerNumber: 3 }),
      ev('period_end', K + 45 * MIN, { period: 1 }),
      ev('period_start', K + 60 * MIN, { period: 2 }),
    ]);
    expect(buildReport(rules, state).periods.map((p) => p.score)).toEqual([
      { home: 0, away: 1 },
      { home: 0, away: 1 },
    ]);
  });
});

describe('reportText', () => {
  const header = { title: 'Informe', teams: { home: 'Leones', away: 'Tigres' }, tournament: 'Liga', date: 'sáb 25 oct' };

  it('lists the match as plain text and hides notes unless asked', () => {
    const report = buildReport(rules, deriveState(rules, fullMatch()));
    const text = reportText(report, header, { ...LABELS, notes: null });
    expect(text).toContain('Leones 2 – 1 Tigres');
    expect(text).toContain("- 56' Tigres: 5 (en propia, Leones)");
    expect(text).toContain("- 66' Segunda amarilla · Tigres: 4");
    expect(text).toContain("- 61' Tigres: 10 → 14");
    expect(text).not.toContain('Banquillo');
    expect(reportText(report, header, LABELS)).toContain("- 22' Tigres: Banquillo protesta");
  });

  it('marks unfinished matches', () => {
    const report = buildReport(rules, deriveState(rules, [ev('period_start', K, { period: 1 })]));
    expect(reportText(report, header, LABELS)).toContain('Sin terminar');
  });
});
