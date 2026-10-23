import { describe, expect, it } from 'vitest';
import { normalizeCode, CODE_PATTERN } from './components/Watches.tsx';
import { parseRoute, href } from './hooks.ts';
import { liveUrl, secondYellowIds, serverOffsetMs } from './live.ts';

describe('live link', () => {
  it('puts the token in the fragment and round-trips through the router', () => {
    const url = liveUrl('https://arbitraje-remoto.vercel.app', '0b0e3a1c-1111-4222-8333-444455556666', 'tok_ABC-123');
    expect(url).toBe('https://arbitraje-remoto.vercel.app/#/vivo/0b0e3a1c-1111-4222-8333-444455556666/tok_ABC-123');
    expect(parseRoute(new URL(url).hash)).toEqual({ name: 'live', id: '0b0e3a1c-1111-4222-8333-444455556666', token: 'tok_ABC-123' });
  });

  it('routes the report page', () => {
    expect(parseRoute(href.report('abc'))).toEqual({ name: 'report', id: 'abc' });
    expect(parseRoute('#/vivo/abc')).toEqual({ name: 'matches' });
  });
});

describe('serverOffsetMs', () => {
  it('measures the server clock against the middle of the request', () => {
    expect(serverOffsetMs('2026-10-25T16:00:10.000Z', Date.parse('2026-10-25T16:00:00.000Z'), Date.parse('2026-10-25T16:00:02.000Z'))).toBe(9000);
    expect(serverOffsetMs('not a date', 0, 0)).toBe(0);
  });
});

describe('secondYellowIds', () => {
  it('finds the second yellow of the same player only', () => {
    const y = (id: string, team: 'home' | 'away', playerNumber: number | null) => ({ id, type: 'yellow_card' as const, team, playerNumber });
    expect([...secondYellowIds([y('a', 'home', 4), y('b', 'away', 4), y('c', 'home', 4), y('d', 'home', null), y('e', 'home', null)])]).toEqual(['c']);
  });
});

describe('pairing code input', () => {
  it('accepts lower case, spaces and hyphens; rejects ambiguous characters', () => {
    expect(normalizeCode(' k7m-3qx ')).toBe('K7M3QX');
    expect(CODE_PATTERN.test(normalizeCode('k7m-3qx'))).toBe(true);
    expect(CODE_PATTERN.test('K7M3Q0')).toBe(false);
    expect(CODE_PATTERN.test('K7M3QL')).toBe(false);
    expect(CODE_PATTERN.test('K7M3Q')).toBe(false);
  });
});
