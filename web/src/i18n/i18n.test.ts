import { describe, expect, it } from 'vitest';
import en from './en.json' with { type: 'json' };
import es from './es.json' with { type: 'json' };

describe('translations', () => {
  it('Spanish and English have the same keys and placeholders', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(es) as (keyof typeof es)[]) {
      expect(vars(en[key]), key).toEqual(vars(es[key]));
    }
  });
});
