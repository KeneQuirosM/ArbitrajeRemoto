// Small HTTP helpers on top of the Fetch API Request/Response.

import { ApiError, badRequest } from './errors.ts';

export const BODY_LIMITS = {
  default: 16 * 1024,
  events: 64 * 1024,
} as const;

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function noContent(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function errorResponse(error: ApiError): Response {
  const body: { error: { code: string; message: string; details?: Record<string, unknown> } } = {
    error: { code: error.code, message: error.message },
  };
  if (error.details) body.error.details = error.details;
  return json(body, error.status, error.headers);
}

/** Reads a JSON object body, enforcing Content-Type and a byte limit. */
export async function readJson(req: Request, limit: number = BODY_LIMITS.default): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > limit) throw tooLarge(limit);
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength > limit) throw tooLarge(limit);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw badRequest('Body is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw badRequest('Body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

const tooLarge = (limit: number) =>
  new ApiError(413, 'PAYLOAD_TOO_LARGE', `Body larger than ${limit} bytes`, { limitBytes: limit });

export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export function sessionCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${name}=${value}`,
    'Path=/api',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Strict',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
