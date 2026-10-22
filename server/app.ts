// API v1 router. Framework-free: takes a Fetch API Request and returns a Response,
// so the same code runs in Netlify Functions, the local dev server and the tests.

import type { Ctx, Deps } from './context.ts';
import { ApiError, notFound } from './errors.ts';
import { errorResponse, json } from './http.ts';
import {
  createMatch,
  deleteMatch,
  getEvents,
  getLive,
  getMatch,
  listMatches,
  patchMatch,
  postEvents,
} from './matches.ts';
import {
  approvePairing,
  getSession,
  listDevices,
  login,
  logout,
  pollPairing,
  requestPairing,
  revokeDevice,
} from './pairing.ts';
import { ConflictRetriesExhausted } from './store.ts';
import { deleteTeam, listTeams, putTeam } from './teams.ts';

export const API_PREFIX = '/api/v1';
export const API_VERSION = '1.0.0';

type Handler = (ctx: Ctx) => Promise<Response>;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

const health: Handler = async (ctx) =>
  json({ ok: true, version: API_VERSION, serverTime: new Date(ctx.deps.now()).toISOString() });

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/\{(\w+)\}/g, (_m, key: string) => {
        keys.push(key);
        return '([^/]+)';
      }) +
      '/?$',
  );
  return { method, pattern, keys, handler };
}

const ROUTES: Route[] = [
  route('GET', '/health', health),
  route('GET', '/session', getSession),
  route('POST', '/session', login),
  route('DELETE', '/session', logout),
  route('GET', '/matches', listMatches),
  route('POST', '/matches', createMatch),
  route('GET', '/matches/{id}', getMatch),
  route('PATCH', '/matches/{id}', patchMatch),
  route('DELETE', '/matches/{id}', deleteMatch),
  route('GET', '/matches/{id}/events', getEvents),
  route('POST', '/matches/{id}/events', postEvents),
  route('GET', '/matches/{id}/live', getLive),
  route('GET', '/teams', listTeams),
  route('PUT', '/teams/{id}', putTeam),
  route('DELETE', '/teams/{id}', deleteTeam),
  route('POST', '/pairing/request', requestPairing),
  route('POST', '/pairing/approve', approvePairing),
  route('POST', '/pairing/poll', pollPairing),
  route('GET', '/devices', listDevices),
  route('DELETE', '/devices/{keyId}', revokeDevice),
];

export function createApp(deps: Deps) {
  return {
    async handle(req: Request, ip: string): Promise<Response> {
      const url = new URL(req.url);
      try {
        if (!url.pathname.startsWith(API_PREFIX)) throw notFound('Endpoint');
        const path = url.pathname.slice(API_PREFIX.length) || '/';
        const method = req.method === 'HEAD' ? 'GET' : req.method;
        let pathMatched = false;
        for (const r of ROUTES) {
          const match = r.pattern.exec(path);
          if (!match) continue;
          pathMatched = true;
          if (r.method !== method) continue;
          const params: Record<string, string> = {};
          r.keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1]!)));
          return await r.handler({ req, url, ip, deps, params });
        }
        if (pathMatched) {
          const allowed = ROUTES.filter((r) => r.pattern.test(path)).map((r) => r.method);
          throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', undefined, { Allow: allowed.join(', ') });
        }
        throw notFound('Endpoint');
      } catch (error) {
        if (error instanceof ApiError) return errorResponse(error);
        if (error instanceof ConflictRetriesExhausted) {
          return errorResponse(new ApiError(503, 'BUSY', 'Too many concurrent writes, retry shortly', undefined, { 'Retry-After': '1' }));
        }
        if (error instanceof URIError) return errorResponse(notFound('Endpoint'));
        console.error('Unhandled API error', error);
        return errorResponse(new ApiError(500, 'INTERNAL', 'Unexpected server error'));
      }
    },
  };
}
