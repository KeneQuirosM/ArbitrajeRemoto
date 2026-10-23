import { describe, expect, it } from 'vitest';
import { cleanText, validateEvent, validatePlayerNumber, validatePlayers, validateTimestamp } from './validate.ts';

const ID = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const TS = '2026-10-25T16:05:00.000Z';

describe('validatePlayerNumber', () => {
  it('accepts 1–99 integers only', () => {
    expect(validatePlayerNumber(1).ok).toBe(true);
    expect(validatePlayerNumber(99).ok).toBe(true);
    for (const bad of [0, 100, 7.5, '7', -1, NaN]) expect(validatePlayerNumber(bad).ok).toBe(false);
  });
});

describe('validateTimestamp', () => {
  it('requires an explicit time zone and normalizes to UTC', () => {
    expect(validateTimestamp('2026-10-25T18:05:00+02:00', 'x')).toEqual({ ok: true, value: TS });
    expect(validateTimestamp('2026-10-25T16:05:00', 'x').ok).toBe(false);
    expect(validateTimestamp('ayer', 'x').ok).toBe(false);
  });
});

describe('cleanText', () => {
  it('strips control characters and trims', () => {
    expect(cleanText('  hola\u0000\u0007 mundo ')).toBe('hola mundo');
    expect(cleanText('a\nb', true)).toBe('a\nb');
    expect(cleanText('a\nb')).toBe('a b');
  });
});

describe('validateEvent', () => {
  const base = { id: ID, clientTimestamp: TS };

  it('normalizes a goal and drops fields that do not apply', () => {
    const r = validateEvent({ ...base, type: 'goal', team: 'home', playerNumber: 9, text: 'ignored', id: ID.toUpperCase() });
    expect(r.ok && r.value).toMatchObject({ id: ID, type: 'goal', team: 'home', playerNumber: 9, text: null });
  });

  it('rejects unknown types and bad teams', () => {
    expect(validateEvent({ ...base, type: 'penalty' })).toEqual({ ok: false, reason: 'invalid_type' });
    expect(validateEvent({ ...base, type: 'goal', team: 'visitors' })).toEqual({ ok: false, reason: 'invalid_team' });
    expect(validateEvent({ ...base, type: 'goal' })).toEqual({ ok: false, reason: 'missing_team' });
  });

  it('checks substitutions', () => {
    expect(validateEvent({ ...base, type: 'substitution', team: 'away', playerOutNumber: 5, playerInNumber: 5 })).toEqual({
      ok: false,
      reason: 'same_player_in_and_out',
    });
    expect(validateEvent({ ...base, type: 'substitution', team: 'away', playerOutNumber: 5 }).ok).toBe(false);
  });

  it('limits note length and keeps text safe for storage', () => {
    expect(validateEvent({ ...base, type: 'note', text: 'x'.repeat(501) })).toEqual({ ok: false, reason: 'text_too_long' });
    const r = validateEvent({ ...base, type: 'note', text: '<script>alert(1)</script>' });
    // Stored as-is (escaping happens when displaying); only control chars are removed.
    expect(r.ok && r.value.text).toBe('<script>alert(1)</script>');
  });

  it('requires period for period_start/end and a target for void', () => {
    expect(validateEvent({ ...base, type: 'period_start' }).ok).toBe(false);
    expect(validateEvent({ ...base, type: 'period_start', period: 5 }).ok).toBe(false);
    expect(validateEvent({ ...base, type: 'void' }).ok).toBe(false);
    expect(validateEvent({ ...base, type: 'void', voidsEventId: ID })).toEqual({ ok: false, reason: 'cannot_void_itself' });
  });

  it('rejects bad ids and missing timestamps', () => {
    expect(validateEvent({ id: 'abc', type: 'match_end', clientTimestamp: TS }).ok).toBe(false);
    expect(validateEvent({ id: ID, type: 'match_end' }).ok).toBe(false);
    expect(validateEvent(null).ok).toBe(false);
  });
});

describe('validatePlayers', () => {
  let n = 0;
  const makeId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

  it('sorts by number and rejects duplicates', () => {
    const r = validatePlayers([{ number: 10, name: 'Ana' }, { number: 1 }], makeId);
    expect(r.ok && r.value.map((p) => p.number)).toEqual([1, 10]);
    expect(validatePlayers([{ number: 3 }, { number: 3 }], makeId)).toEqual({ ok: false, reason: 'duplicate_player_number' });
    expect(validatePlayers([{ number: 100 }], makeId).ok).toBe(false);
  });
});
