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

/** Tests: route requests to an in-process API. */
export function configureApi(options: { fetch?: Fetcher; base?: string }): void {
  if (options.fetch) fetcher = options.fetch;
  if (options.base !== undefined) base = options.base;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  let res: Response;
  try {
    res = await fetcher(base + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (error) {
    throw new NetworkError(error instanceof Error ? error.message : 'Network error');
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
