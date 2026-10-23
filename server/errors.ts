// Consistent error format: { "error": { "code": "...", "message": "...", "details"?: {...} } }

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'ID_CONFLICT'
  | 'CODE_USED'
  | 'CODE_EXPIRED'
  | 'GONE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'SERVER_MISCONFIGURED'
  | 'BUSY'
  | 'INTERNAL';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new ApiError(400, 'BAD_REQUEST', message, details);
export const validationError = (reason: string) =>
  new ApiError(422, 'VALIDATION_ERROR', `Invalid input: ${reason}`, { reason });
export const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
export const forbidden = (message = 'Not allowed with these credentials') =>
  new ApiError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const gone = (message: string, code: ErrorCode = 'GONE') => new ApiError(410, code, message);
export const rateLimited = (retryAfterSeconds: number) =>
  new ApiError(
    429,
    'RATE_LIMITED',
    'Too many requests, try again later',
    { retryAfterSeconds },
    { 'Retry-After': String(retryAfterSeconds) },
  );
