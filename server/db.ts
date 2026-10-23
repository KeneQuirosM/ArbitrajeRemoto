// Postgres connection (Supabase in production, a local Postgres in development and tests).

import postgres from 'postgres';

export type Sql = postgres.Sql;

/** Plain local databases do not use TLS; anything else must (Supabase requires it). */
function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Settings recommended by Supabase for serverless functions using the shared pooler
 * in transaction mode: one connection per warm instance, no prepared statements, TLS required.
 */
export function createSql(url: string): Sql {
  return postgres(url, {
    max: 1,
    prepare: false,
    ssl: isLocal(url) ? false : 'require',
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
}
