// Local API server for development and the curl examples (no Netlify account needed).
// Usage: npm run dev:api   (reads .env if present; data saved in .data/store.json)
// Plain http on localhost: cookies are sent without the Secure flag here only.

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp } from '../server/app.ts';
import { FileStore, MemoryStore } from '../server/store.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.PORT ?? 8787);
const store = process.env.DEV_STORE === 'memory' ? new MemoryStore() : new FileStore('.data/store.json');
const app = createApp({ store, env: process.env, now: Date.now, uuid: randomUUID, secureCookies: false });

const server = createServer(async (req, res) => {
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
  console.log(`ArbitrajeRemoto API listening on http://localhost:${port}/api/v1`);
});
