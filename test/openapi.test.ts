import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTE_TABLE } from '../server/app.ts';

// Light structural check without a YAML parser: every route has a path entry and an operation in openapi.yaml.
describe('openapi.yaml', () => {
  const spec = readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8');

  function operationsOf(path: string): string[] {
    const start = spec.indexOf(`\n  ${path}:\n`);
    if (start < 0) return [];
    const rest = spec.slice(start + path.length + 5);
    const end = rest.search(/\n {2}\/|\ncomponents:/);
    const block = end < 0 ? rest : rest.slice(0, end);
    return [...block.matchAll(/^ {4}(get|post|put|patch|delete):$/gm)].map((m) => m[1]!.toUpperCase());
  }

  it('documents every API route', () => {
    for (const [method, path] of ROUTE_TABLE) {
      expect(operationsOf(path), `${method} ${path}`).toContain(method);
    }
  });

  it('documents no route the API does not have', () => {
    const documented = [...spec.matchAll(/^ {2}(\/\S*):$/gm)].flatMap((m) => operationsOf(m[1]!).map((op) => `${op} ${m[1]}`));
    const real = ROUTE_TABLE.map(([method, path]) => `${method} ${path}`);
    expect(documented.sort()).toEqual([...real].sort());
  });
});
