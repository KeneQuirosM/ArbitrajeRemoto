// Match report: a pure summary of a match built from its derived timeline.
// Used by the printable report page (print or save as PDF) and by the plain-text share.

import type { DerivedEvent, Match, MatchState, Player, TeamSide } from '../../core/types.ts';

export interface ReportGoal {
  id: string;
  minute: string | null;
  /** Team whose score went up (for an own goal, the opponent of the player's team). */
  scoringTeam: TeamSide;
  /** Team of the player. */
  playerTeam: TeamSide;
  playerNumber: number | null;
  playerName: string | null;
  ownGoal: boolean;
}

export interface ReportCard {
  id: string;
  minute: string | null;
  team: TeamSide;
  playerNumber: number | null;
  playerName: string | null;
  kind: 'yellow' | 'red' | 'secondYellow';
}

export interface ReportSub {
  id: string;
  minute: string | null;
  team: TeamSide;
  outNumber: number | null;
  outName: string | null;
  inNumber: number | null;
  inName: string | null;
}

export interface ReportNote {
  id: string;
  minute: string | null;
  team: TeamSide | null;
  text: string;
}

export interface ReportPeriod {
  period: number;
  startedAt: number | null;
  endedAt: number | null;
  addedMinutes: number | null;
  /** Score at the end of this period (cumulative). */
  score: { home: number; away: number };
}

export interface MatchReport {
  finished: boolean;
  score: { home: number; away: number };
  periods: ReportPeriod[];
  goals: ReportGoal[];
  cards: ReportCard[];
  subs: ReportSub[];
  notes: ReportNote[];
  /** Real time of the first kick-off, if any. */
  kickOffAt: number | null;
  endedAt: number | null;
}

export type Rosters = Partial<Record<TeamSide, readonly Player[]>>;

const other = (side: TeamSide): TeamSide => (side === 'home' ? 'away' : 'home');

function nameOf(rosters: Rosters, team: TeamSide | null, number: number | null): string | null {
  if (!team || number === null) return null;
  return rosters[team]?.find((p) => p.number === number)?.name || null;
}

export function buildReport(match: Pick<Match, 'periods'>, state: MatchState, rosters: Rosters = {}): MatchReport {
  const goals: ReportGoal[] = [];
  const cards: ReportCard[] = [];
  const subs: ReportSub[] = [];
  const notes: ReportNote[] = [];
  const periods = new Map<number, ReportPeriod>();
  const yellows = new Map<string, number>();
  const running = { home: 0, away: 0 };
  let kickOffAt: number | null = null;
  let endedAt: number | null = null;

  const periodEntry = (n: number): ReportPeriod => {
    let entry = periods.get(n);
    if (!entry) {
      entry = { period: n, startedAt: null, endedAt: null, addedMinutes: null, score: { home: 0, away: 0 } };
      periods.set(n, entry);
    }
    return entry;
  };

  for (const e of state.timeline as readonly DerivedEvent[]) {
    const minute = e.minuteLabel;
    switch (e.type) {
      case 'goal':
      case 'own_goal': {
        if (!e.team) break;
        const ownGoal = e.type === 'own_goal';
        const scoringTeam = ownGoal ? other(e.team) : e.team;
        running[scoringTeam] += 1;
        goals.push({ id: e.id, minute, scoringTeam, playerTeam: e.team, playerNumber: e.playerNumber, playerName: nameOf(rosters, e.team, e.playerNumber), ownGoal });
        break;
      }
      case 'yellow_card':
      case 'red_card': {
        if (!e.team) break;
        let kind: ReportCard['kind'] = e.type === 'red_card' ? 'red' : 'yellow';
        if (e.type === 'yellow_card' && e.playerNumber !== null) {
          const key = `${e.team}:${e.playerNumber}`;
          const count = (yellows.get(key) ?? 0) + 1;
          yellows.set(key, count);
          if (count === 2) kind = 'secondYellow';
        }
        cards.push({ id: e.id, minute, team: e.team, playerNumber: e.playerNumber, playerName: nameOf(rosters, e.team, e.playerNumber), kind });
        break;
      }
      case 'substitution':
        if (!e.team) break;
        subs.push({
          id: e.id,
          minute,
          team: e.team,
          outNumber: e.playerOutNumber,
          outName: nameOf(rosters, e.team, e.playerOutNumber),
          inNumber: e.playerInNumber,
          inName: nameOf(rosters, e.team, e.playerInNumber),
        });
        break;
      case 'note':
        notes.push({ id: e.id, minute, team: e.team, text: e.text ?? '' });
        break;
      case 'period_start':
        if (e.period !== null) {
          periodEntry(e.period).startedAt ??= e.t;
          kickOffAt ??= e.t;
        }
        break;
      case 'period_end':
        if (e.period !== null) periodEntry(e.period).endedAt = e.t;
        break;
      case 'added_time': {
        const n = e.period ?? e.atPeriod;
        if (n !== null && e.minutes !== null) periodEntry(n).addedMinutes = e.minutes;
        break;
      }
      case 'match_end':
        endedAt = e.t;
        if (e.atPeriod !== null) {
          const entry = periodEntry(e.atPeriod);
          entry.endedAt ??= e.t;
        }
        break;
    }
    // Score at the end of each period = running score after its last event.
    const n = e.atPeriod ?? (e.type === 'period_start' ? e.period : null);
    if (n !== null && periods.has(n)) periods.get(n)!.score = { ...running };
  }

  // A period whose last scoring event came after it ended still shows the right running total.
  const ordered = [...periods.values()].sort((a, b) => a.period - b.period);
  let carry = { home: 0, away: 0 };
  for (const p of ordered) {
    if (p.score.home < carry.home || p.score.away < carry.away) p.score = { ...carry };
    carry = p.score;
  }

  return {
    finished: state.status === 'finished',
    score: state.score,
    periods: ordered.filter((p) => p.period <= match.periods),
    goals,
    cards,
    subs,
    notes,
    kickOffAt,
    endedAt,
  };
}

// --- Plain text (for sharing in a chat app) -----------------------------------

export interface TextNames {
  home: string;
  away: string;
}

export function reportText(
  report: MatchReport,
  header: { title: string; teams: TextNames; tournament: string | null; date: string | null },
  labels: {
    score: string;
    unfinished: string;
    goals: string;
    cards: string;
    subs: string;
    notes: string | null;
    ownGoal: string;
    yellow: string;
    red: string;
    secondYellow: string;
    noNumber: string;
  },
): string {
  const team = (side: TeamSide | null) => (side === 'home' ? header.teams.home : side === 'away' ? header.teams.away : '');
  const minute = (m: string | null) => (m ? `${m}'` : '–');
  const player = (n: number | null, name: string | null) => (n === null ? labels.noNumber : name ? `${n} ${name}` : String(n));
  const lines: string[] = [header.title];
  if (header.tournament) lines.push(header.tournament);
  if (header.date) lines.push(header.date);
  lines.push('', `${header.teams.home} ${report.score.home} – ${report.score.away} ${header.teams.away}`);
  if (!report.finished) lines.push(labels.unfinished);

  const section = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    lines.push('', title, ...rows.map((r) => `- ${r}`));
  };
  section(
    labels.goals,
    report.goals.map((g) => `${minute(g.minute)} ${team(g.scoringTeam)}: ${player(g.playerNumber, g.playerName)}${g.ownGoal ? ` (${labels.ownGoal}, ${team(g.playerTeam)})` : ''}`),
  );
  section(
    labels.cards,
    report.cards.map((c) => `${minute(c.minute)} ${c.kind === 'yellow' ? labels.yellow : c.kind === 'red' ? labels.red : labels.secondYellow} · ${team(c.team)}: ${player(c.playerNumber, c.playerName)}`),
  );
  section(labels.subs, report.subs.map((s) => `${minute(s.minute)} ${team(s.team)}: ${player(s.outNumber, s.outName)} → ${player(s.inNumber, s.inName)}`));
  if (labels.notes !== null) section(labels.notes, report.notes.map((n) => `${minute(n.minute)}${n.team ? ` ${team(n.team)}` : ''}: ${n.text}`));
  return lines.join('\n');
}
