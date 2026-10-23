// Applies supabase/migrations/*.sql in order to the database in DATABASE_URL.
// Usage: DATABASE_URL='postgresql://...' npm run db:migrate
// Every migration is written to be safe to run again; applied names are recorded
// in arbitraje.schema_migrations so each one normally runs once.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSql } from '../server/db.ts';

export async function migrate(url: string, log: (line: string) => void = console.log): Promise<string[]> {
  const sql = createSql(url);
  const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  try {
    await sql.unsafe(`
      create schema if not exists arbitraje;
      create table if not exists arbitraje.schema_migrations (name text primary key, applied_at timestamptz not null default now());
      alter table arbitraje.schema_migrations enable row level security;`);
    const done = new Set((await sql<{ name: string }[]>`select name from arbitraje.schema_migrations`).map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const text = readFileSync(join(dir, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into arbitraje.schema_migrations (name) values (${file})`;
      });
      applied.push(file);
      log(`applied ${file}`);
    }
    if (applied.length === 0) log('database is up to date');
  } finally {
    await sql.end();
  }
  return applied;
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_URL (see docs/DESPLIEGUE.md).');
    process.exit(1);
  }
  await migrate(url);
}
