// Request context, dependencies and authentication.

import {
  MIN_SESSION_SECRET_LENGTH,
  SESSION_COOKIE,
  isValidPassphraseHash,
  parseDeviceKey,
  safeEqual,
  verifySessionToken,
} from './crypto.ts';
import { ApiError, forbidden, unauthorized } from './errors.ts';
import { getCookie } from './http.ts';
import type { KVStore } from './store.ts';

export interface Env {
  ADMIN_PASSPHRASE_HASH?: string | undefined;
  SESSION_SECRET?: string | undefined;
}

export interface Deps {
  store: KVStore;
  env: Env;
  now: () => number;
  uuid: () => string;
  /** False only for the local http dev server. */
  secureCookies: boolean;
}

export type Principal =
  | { role: 'owner' }
  | { role: 'device'; keyId: string; deviceId: string; deviceName: string | null };

export interface Ctx {
  req: Request;
  url: URL;
  ip: string;
  deps: Deps;
  params: Record<string, string>;
}

export interface DeviceRecord {
  keyId: string;
  deviceId: string;
  deviceName: string | null;
  secretHash: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export const deviceKeyPath = (keyId: string) => `devices/${keyId}`;

const LAST_SEEN_RESOLUTION_MS = 60 * 60 * 1000;

export function requireConfig(env: Env): { passphraseHash: string; sessionSecret: string } {
  const passphraseHash = env.ADMIN_PASSPHRASE_HASH;
  const sessionSecret = env.SESSION_SECRET;
  if (!isValidPassphraseHash(passphraseHash) || !sessionSecret || sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new ApiError(
      500,
      'SERVER_MISCONFIGURED',
      'ADMIN_PASSPHRASE_HASH and SESSION_SECRET must be set (see docs/DESPLIEGUE.md)',
    );
  }
  return { passphraseHash: passphraseHash as string, sessionSecret };
}

/** Owner (session cookie) or device (Bearer device key); null when no credentials were sent. */
export async function authenticate(ctx: Ctx): Promise<Principal | null> {
  const auth = ctx.req.headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    const parsed = match ? parseDeviceKey(match[1]!) : null;
    if (!parsed) throw unauthorized();
    const doc = await ctx.deps.store.get<DeviceRecord>(deviceKeyPath(parsed.keyId));
    const device = doc?.data;
    if (!device || device.revokedAt || !safeEqual(device.secretHash, parsed.secretHash)) throw unauthorized();
    await touchDevice(ctx, device, doc!.etag);
    return { role: 'device', keyId: device.keyId, deviceId: device.deviceId, deviceName: device.deviceName };
  }
  const cookie = getCookie(ctx.req, SESSION_COOKIE);
  if (!cookie) return null;
  const { sessionSecret } = requireConfig(ctx.deps.env);
  return verifySessionToken(cookie, sessionSecret, ctx.deps.now()) ? { role: 'owner' } : null;
}

/** Updates lastSeenAt at most once an hour; never fails the request. */
async function touchDevice(ctx: Ctx, device: DeviceRecord, etag: string): Promise<void> {
  const now = ctx.deps.now();
  if (device.lastSeenAt && now - Date.parse(device.lastSeenAt) < LAST_SEEN_RESOLUTION_MS) return;
  try {
    await ctx.deps.store.set(
      deviceKeyPath(device.keyId),
      { ...device, lastSeenAt: new Date(now).toISOString() },
      { onlyIfMatch: etag },
    );
  } catch {
    // Best effort.
  }
}

export async function requireOwner(ctx: Ctx): Promise<Principal> {
  const principal = await authenticate(ctx);
  if (!principal) throw unauthorized();
  if (principal.role !== 'owner') throw forbidden('This action needs the owner session');
  return principal;
}

export async function requireOwnerOrDevice(ctx: Ctx): Promise<Principal> {
  const principal = await authenticate(ctx);
  if (!principal) throw unauthorized();
  return principal;
}
