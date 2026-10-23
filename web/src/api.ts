// Minimal client for /api/v1 (same origin, session cookie).

export class NetworkError extends Error {}

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

let fetcher: Fetcher = (input, init) => fetch(input, init);
let base = '/api/v1';

export const REQUEST_TIMEOUT_MS = 15_000;

/** Tests: route requests to an in-process API. */
export function configureApi(options: { fetch?: Fetcher; base?: string }): void {
  if (options.fetch) fetcher = options.fetch;
  if (options.base !== undefined) base = options.base;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  let res: Response;
  // Weak signal on the pitch can leave a request hanging: give up and retry later instead.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    res = await fetcher(base + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    throw new NetworkError(error instanceof Error ? error.message : 'Network error');
  } finally {
    clearTimeout(timer);
  }
  const text = res.status === 204 || res.status === 304 ? '' : await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiFailure(res.status, 'BAD_RESPONSE', 'The server answered with something that is not JSON');
    }
  }
  if (!res.ok && res.status !== 304) {
    throw new ApiFailure(res.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? `HTTP ${res.status}`);
  }
  return { status: res.status, data };
}

/**
 * Conditional GET for polling: sends `If-None-Match` and returns the new ETag.
 * `data` is null when the server answers 304 (nothing changed).
 */
export async function getIfChanged<T = any>(path: string, etag: string | null): Promise<{ status: number; data: T | null; etag: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetcher(base + path, {
      method: 'GET',
      credentials: 'omit',
      headers: etag ? { 'If-None-Match': etag } : {},
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    throw new NetworkError(error instanceof Error ? error.message : 'Network error');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 304) return { status: 304, data: null, etag };
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiFailure(res.status, 'BAD_RESPONSE', 'The server answered with something that is not JSON');
  }
  if (!res.ok) throw new ApiFailure(res.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? `HTTP ${res.status}`);
  return { status: res.status, data, etag: res.headers.get('ETag') };
}
