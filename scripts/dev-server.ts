// Local server for development, the curl examples and the end-to-end tests (no Vercel or Supabase account needed).
// Serves the API at /api/v1 and the built web app (web/dist, after `npm run build`) everywhere else.
// Usage: npm run dev:api   (reads .env if present)
// Storage: DEV_STORE=file (default, .data/store.json), memory, or postgres (uses DATABASE_URL,
// e.g. a local Postgres after `npm run db:migrate`).
// Plain http on localhost: cookies are sent without the Secure flag here only.

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { createApp } from '../server/app.ts';
import { createSql } from '../server/db.ts';
import { PostgresStore } from '../server/pgstore.ts';
import { FileStore, MemoryStore, type KVStore } from '../server/store.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.PORT ?? 8787);
function makeStore(): KVStore {
  switch (process.env.DEV_STORE) {
    case 'memory':
      return new MemoryStore();
    case 'postgres':
      if (!process.env.DATABASE_URL) throw new Error('DEV_STORE=postgres needs DATABASE_URL');
      return new PostgresStore(createSql(process.env.DATABASE_URL));
    default:
      return new FileStore('.data/store.json');
  }
}
const store = makeStore();
const app = createApp({ store, env: process.env, now: Date.now, uuid: randomUUID, secureCookies: false });

const STATIC_DIR = process.env.STATIC_DIR ?? 'web/dist';
// Same Content-Security-Policy as production, so CSP problems show up locally and in the e2e tests.
const CSP =
  (JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] }).headers
    .flatMap((rule) => rule.headers)
    .find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serveStatic(url: string): { status: number; type: string; body: Buffer } {
  const path = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const file = normalize(join(STATIC_DIR, path === '/' ? 'index.html' : path));
  if (!file.startsWith(normalize(STATIC_DIR)) || !existsSync(file) || !statSync(file).isFile()) {
    const index = join(STATIC_DIR, 'index.html');
    if (!existsSync(index)) return { status: 404, type: 'text/plain', body: Buffer.from('Run `npm run build` first') };
    return { status: 404, type: 'text/plain', body: Buffer.from('Not found') };
  }
  return { status: 200, type: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) };
}

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/api/')) {
    const file = serveStatic(req.url ?? '/');
    res.writeHead(file.status, { 'Content-Type': file.type, 'Cache-Control': 'no-cache', 'Content-Security-Policy': CSP });
    res.end(file.body);
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
  }
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers,
    body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
  });
  const response = await app.handle(request, req.socket.remoteAddress ?? 'local');
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`ArbitrajeRemoto on http://localhost:${port}/ (API at /api/v1)`);
});
