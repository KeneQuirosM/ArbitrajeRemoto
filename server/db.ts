// Postgres connection (Supabase or Neon in production, a local Postgres in development and tests).

import postgres from 'postgres';

export type Sql = postgres.Sql;

/** Plain local databases do not use TLS; anything else must (Supabase requires it). */
function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * libpq-only URL options that Postgres.js would otherwise forward to the server as startup
 * parameters, which the server rejects. Neon adds `channel_binding=require` to its URLs.
 */
const CLIENT_ONLY_PARAMS = ['channel_binding'];

/** The URL without the client-only options Postgres.js does not understand. */
export function connectionUrl(url: string): string {
  const parsed = new URL(url);
  if (!CLIENT_ONLY_PARAMS.some((name) => parsed.searchParams.has(name))) return url;
  for (const name of CLIENT_ONLY_PARAMS) parsed.searchParams.delete(name);
  return parsed.toString();
}

/**
 * Settings recommended by Supabase for serverless functions using the shared pooler
 * in transaction mode: one connection per warm instance, no prepared statements, TLS required.
 */
export function createSql(url: string): Sql {
  return postgres(connectionUrl(url), {
    max: 1,
    prepare: false,
    ssl: isLocal(url) ? false : 'require',
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
}
