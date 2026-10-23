// Public live view: link building and the pure helpers behind the spectator screen.
// The live API never returns notes, device ids or owner data; this page only shows what it gets.

import type { ClockState, DerivedEvent, Match, MatchStatus, TeamSide } from '../../core/types.ts';

/** One timeline entry as returned by GET /matches/{id}/live. */
export interface LiveTimelineEntry {
  id: string;
  type: DerivedEvent['type'];
  team: TeamSide | null;
  playerNumber: number | null;
  playerOutNumber: number | null;
  playerInNumber: number | null;
  period: number | null;
  minutes: number | null;
  atPeriod: number | null;
  minuteLabel: string | null;
}

export interface LiveData {
  match: Pick<Match, 'homeTeamName' | 'awayTeamName' | 'tournament' | 'scheduledAt' | 'periods' | 'periodMinutes'>;
  state: { status: MatchStatus; score: { home: number; away: number }; clock: ClockState; lastSeq: number };
  timeline: LiveTimelineEntry[];
  serverTime: string;
}

/** How often the spectator page asks for changes (304 when nothing changed). */
export const LIVE_POLL_MS = 10_000;

/** Link to share. The token goes in the #fragment, so it never reaches server logs as a page URL. */
export function liveUrl(origin: string, matchId: string, token: string): string {
  return `${origin}/#/vivo/${encodeURIComponent(matchId)}/${encodeURIComponent(token)}`;
}

/**
 * Difference between the server clock and this device's clock, measured from a response.
 * Uses the middle of the request so that a slow network does not shift the clock.
 */
export function serverOffsetMs(serverTime: string, sentAt: number, receivedAt: number): number {
  const server = Date.parse(serverTime);
  if (Number.isNaN(server)) return 0;
  return server - Math.round((sentAt + receivedAt) / 2);
}

/** Ids of the yellow cards that are a player's second one (the timeline is in match order). */
export function secondYellowIds(timeline: readonly Pick<LiveTimelineEntry, 'id' | 'type' | 'team' | 'playerNumber'>[]): Set<string> {
  const seen = new Map<string, number>();
  const result = new Set<string>();
  for (const e of timeline) {
    if (e.type !== 'yellow_card' || e.playerNumber === null) continue;
    const key = `${e.team}:${e.playerNumber}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 2) result.add(e.id);
  }
  return result;
}

/** Adapts a live entry to the shape used by the shared event texts (notes never come from the live API). */
export function toDerived(e: LiveTimelineEntry): DerivedEvent {
  return { ...e, text: null, t: 0 };
}
