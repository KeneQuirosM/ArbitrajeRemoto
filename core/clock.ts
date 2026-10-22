// Match clock helpers. The clock is never stored as accumulated seconds:
// it is always rebuilt from period_start / pause / resume / end timestamps.
// See docs/CRONOMETRO.md for the algorithm and edge cases.

import type { ClockState } from './types.ts';

/** Device clocks closer than this to the server are trusted as-is. */
export const CLOCK_SKEW_THRESHOLD_MS = 30_000;

/** Played milliseconds of the current period at `nowMs` (same time base as `anchorAt`). */
export function elapsedAt(clock: ClockState, nowMs: number): number {
  if (!clock.running || clock.anchorAt === null) return clock.elapsedMs;
  return clock.elapsedMs + Math.max(0, nowMs - clock.anchorAt);
}

/**
 * Football minute label for a moment `elapsedMs` into `period`.
 * The first minute of a 45' half is "1"; 45:00 played is already "45+1".
 * Second half of 2×45 starts at "46".
 */
export function minuteLabel(period: number, elapsedMs: number, periodMinutes: number): string {
  const minute = Math.floor(Math.max(0, elapsedMs) / 60_000) + 1;
  const base = (period - 1) * periodMinutes;
  if (minute > periodMinutes) return `${base + periodMinutes}+${minute - periodMinutes}`;
  return String(base + minute);
}

/** Absolute minute number (no "+"), handy for sorting or compact displays. */
export function absoluteMinute(period: number, elapsedMs: number, periodMinutes: number): number {
  return (period - 1) * periodMinutes + Math.floor(Math.max(0, elapsedMs) / 60_000) + 1;
}

/**
 * Correction to apply to timestamps of a batch, given the server time when the
 * batch arrived and the device time when it was sent (`sentAt`).
 * Small differences (network latency, normal drift) are ignored so that one
 * device's events keep their exact relative spacing.
 */
export function clockOffsetMs(
  serverNowMs: number,
  sentAtMs: number | null,
  thresholdMs = CLOCK_SKEW_THRESHOLD_MS,
): number {
  if (sentAtMs === null || !Number.isFinite(sentAtMs)) return 0;
  const offset = serverNowMs - sentAtMs;
  return Math.abs(offset) > thresholdMs ? offset : 0;
}

/** "mm:ss" for a clock display. Minutes keep counting past 59 (e.g. "92:05"). */
export function formatClock(elapsedMs: number): string {
  const total = Math.floor(Math.max(0, elapsedMs) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
