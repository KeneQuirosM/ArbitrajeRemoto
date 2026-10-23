import { describe, expect, it } from 'vitest';
import { absoluteMinute, clockOffsetMs, elapsedAt, formatClock, minuteLabel } from './clock.ts';

describe('minuteLabel', () => {
  it('counts the first minute as 1', () => {
    expect(minuteLabel(1, 0, 45)).toBe('1');
    expect(minuteLabel(1, 59_999, 45)).toBe('1');
    expect(minuteLabel(1, 60_000, 45)).toBe('2');
  });

  it('switches to added time once the period length is played', () => {
    expect(minuteLabel(1, 44 * 60_000 + 59_999, 45)).toBe('45');
    expect(minuteLabel(1, 45 * 60_000, 45)).toBe('45+1');
    expect(minuteLabel(1, 47 * 60_000 + 30_000, 45)).toBe('45+3');
  });

  it('continues from the previous periods', () => {
    expect(minuteLabel(2, 0, 45)).toBe('46');
    expect(minuteLabel(2, 45 * 60_000 + 1, 45)).toBe('90+1');
    expect(minuteLabel(2, 10 * 60_000, 20)).toBe('31');
  });

  it('never goes below the first minute', () => {
    expect(minuteLabel(1, -5000, 45)).toBe('1');
    expect(absoluteMinute(2, -1, 45)).toBe(46);
  });
});

describe('elapsedAt', () => {
  it('adds running time since the anchor', () => {
    const clock = { period: 1, running: true, elapsedMs: 10_000, anchorAt: 1_000, addedMinutes: null };
    expect(elapsedAt(clock, 6_000)).toBe(15_000);
  });

  it('is frozen while paused and never negative when now < anchor', () => {
    expect(elapsedAt({ period: 1, running: false, elapsedMs: 7_000, anchorAt: null, addedMinutes: null }, 99_999)).toBe(7_000);
    expect(elapsedAt({ period: 1, running: true, elapsedMs: 7_000, anchorAt: 10_000, addedMinutes: null }, 5_000)).toBe(7_000);
  });
});

describe('clockOffsetMs', () => {
  it('ignores small differences (latency, normal drift)', () => {
    expect(clockOffsetMs(100_000, 95_000)).toBe(0);
    expect(clockOffsetMs(100_000, 129_000)).toBe(0);
  });

  it('corrects a device clock that is clearly ahead or behind', () => {
    expect(clockOffsetMs(1_000_000, 1_000_000 + 5 * 60_000)).toBe(-5 * 60_000);
    expect(clockOffsetMs(1_000_000, 1_000_000 - 2 * 60_000)).toBe(2 * 60_000);
  });

  it('does nothing without sentAt', () => {
    expect(clockOffsetMs(1_000_000, null)).toBe(0);
  });
});

describe('formatClock', () => {
  it('formats mm:ss and keeps counting past 59 minutes', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65_400)).toBe('01:05');
    expect(formatClock(92 * 60_000 + 5_000)).toBe('92:05');
  });
});
