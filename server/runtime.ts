// Shared production wiring for the Vercel functions (one instance per warm function).

import { randomUUID } from 'node:crypto';
import { createApp } from './app.ts';
import { createSql, type Sql } from './db.ts';
import { ApiError } from './errors.ts';
import { errorResponse } from './http.ts';
import { PostgresStore } from './pgstore.ts';

let sql: Sql | null = null;
let app: ReturnType<typeof createApp> | null = null;

/** The database client, or null when DATABASE_URL is not configured. */
export function getSql(): Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  sql ??= createSql(url);
  return sql;
}

export function getApp(): ReturnType<typeof createApp> | null {
  const db = getSql();
  if (!db) return null;
  app ??= createApp({ store: new PostgresStore(db), env: process.env, now: Date.now, uuid: randomUUID, secureCookies: true });
  return app;
}

export function misconfigured(): Response {
  return errorResponse(
    new ApiError(500, 'SERVER_MISCONFIGURED', 'DATABASE_URL, ADMIN_PASSPHRASE_HASH and SESSION_SECRET must be set (see docs/DESPLIEGUE.md)'),
  );
}

/** Client IP as seen by Vercel's edge (used only for rate limiting). */
export function clientIp(request: Request): string {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/**
 * vercel.json rewrites /api/v1/<path> to this function with ?__path=<path>.
 * Rebuilds the original URL so the router sees /api/v1/<path> and the original query.
 */
export function originalRequest(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/v1')) return request;
  const path = url.searchParams.get('__path') ?? '';
  url.searchParams.delete('__path');
  url.pathname = `/api/v1/${path}`;
  return new Request(url, request);
}
