// Owner session, watch pairing (watch asks for a code, owner approves it in the web) and devices.

import { LIMITS, validateDeviceId, validateText } from '../core/validate.ts';
import {
  authenticate,
  deviceKeyPath,
  requireConfig,
  requireOwner,
  type Ctx,
  type DeviceRecord,
} from './context.ts';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createDeviceKey,
  createPairingCode,
  createSessionToken,
  normalizePairingCode,
  randomToken,
  safeEqual,
  sha256,
  verifyPassphrase,
} from './crypto.ts';
import { ApiError, badRequest, gone, notFound, validationError } from './errors.ts';
import { json, noContent, readJson, sessionCookie } from './http.ts';
import { LIMIT_RULES, assertUnderLimit, consume, recordHit } from './ratelimit.ts';
import { update } from './store.ts';

export const PAIRING_TTL_MS = 10 * 60_000;
export const POLL_INTERVAL_SECONDS = 5;

export interface PairingDoc {
  code: string;
  deviceId: string;
  deviceName: string | null;
  pollTokenHash: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'claimed';
  approvedAt: string | null;
  claimedAt: string | null;
  keyId: string | null;
}

const pairingKey = (code: string) => `pairing/${code}`;

// --- Session --------------------------------------------------------------

export async function login(ctx: Ctx): Promise<Response> {
  const { passphraseHash, sessionSecret } = requireConfig(ctx.deps.env);
  const now = ctx.deps.now();
  await assertUnderLimit(ctx.deps.store, LIMIT_RULES.loginFailures, ctx.ip, now);
  const body = await readJson(ctx.req);
  if (typeof body.passphrase !== 'string' || body.passphrase.length > 256) throw validationError('invalid_passphrase');
  if (!verifyPassphrase(body.passphrase, passphraseHash)) {
    await recordHit(ctx.deps.store, LIMIT_RULES.loginFailures, ctx.ip, now);
    throw new ApiError(401, 'UNAUTHORIZED', 'Wrong passphrase');
  }
  const token = createSessionToken(sessionSecret, now);
  return json(
    { authenticated: true, role: 'owner', expiresAt: new Date(now + SESSION_TTL_MS).toISOString() },
    200,
    { 'Set-Cookie': sessionCookie(SESSION_COOKIE, token, SESSION_TTL_MS / 1000, ctx.deps.secureCookies) },
  );
}

export async function getSession(ctx: Ctx): Promise<Response> {
  const principal = await authenticate(ctx);
  if (!principal) return json({ authenticated: false });
  if (principal.role === 'owner') return json({ authenticated: true, role: 'owner' });
  return json({ authenticated: true, role: 'device', deviceId: principal.deviceId, keyId: principal.keyId });
}

export async function logout(ctx: Ctx): Promise<Response> {
  return noContent({ 'Set-Cookie': sessionCookie(SESSION_COOKIE, '', 0, ctx.deps.secureCookies) });
}

// --- Pairing --------------------------------------------------------------

/** Watch: asks for a code to show on screen. No credentials needed. */
export async function requestPairing(ctx: Ctx): Promise<Response> {
  const now = ctx.deps.now();
  await consume(ctx.deps.store, LIMIT_RULES.pairingRequest, ctx.ip, now);
  const body = await readJson(ctx.req);
  const deviceId = validateDeviceId(body.deviceId, true);
  if (!deviceId.ok) throw validationError(deviceId.reason);
  const deviceName = validateText(body.deviceName, 'deviceName', LIMITS.deviceName);
  if (!deviceName.ok) throw validationError(deviceName.reason);

  const pollToken = randomToken(32);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = createPairingCode();
    const doc: PairingDoc = {
      code,
      deviceId: deviceId.value as string,
      deviceName: deviceName.value,
      pollTokenHash: sha256(pollToken),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PAIRING_TTL_MS).toISOString(),
      status: 'pending',
      approvedAt: null,
      claimedAt: null,
      keyId: null,
    };
    let created = false;
    // Reuse the slot only if an older code with the same letters has already expired.
    await update<PairingDoc>(ctx.deps.store, pairingKey(code), (current) => {
      if (current && Date.parse(current.expiresAt) > now) return undefined;
      created = true;
      return doc;
    });
    if (created) {
      return json(
        { code, pollToken, expiresAt: doc.expiresAt, pollIntervalSeconds: POLL_INTERVAL_SECONDS },
        201,
      );
    }
  }
  throw new ApiError(503, 'BUSY', 'Could not allocate a pairing code, try again');
}

/** Owner (web): types the code shown on the watch. */
export async function approvePairing(ctx: Ctx): Promise<Response> {
  await requireOwner(ctx);
  const now = ctx.deps.now();
  await assertUnderLimit(ctx.deps.store, LIMIT_RULES.pairingApproveFailures, ctx.ip, now);
  const body = await readJson(ctx.req);
  const code = normalizePairingCode(body.code);
  const deviceName = validateText(body.deviceName, 'deviceName', LIMITS.deviceName);
  if (!deviceName.ok) throw validationError(deviceName.reason);
  const fail = async (error: ApiError) => {
    await recordHit(ctx.deps.store, LIMIT_RULES.pairingApproveFailures, ctx.ip, now);
    return error;
  };
  if (!code) throw await fail(validationError('invalid_code'));

  const doc = await ctx.deps.store.get<PairingDoc>(pairingKey(code));
  if (!doc) throw await fail(notFound('Pairing code'));
  if (doc.data.status !== 'pending') throw await fail(gone('This code was already used', 'CODE_USED'));
  if (Date.parse(doc.data.expiresAt) <= now) throw await fail(gone('This code has expired', 'CODE_EXPIRED'));

  const approved: PairingDoc = {
    ...doc.data,
    deviceName: deviceName.value ?? doc.data.deviceName,
    status: 'approved',
    approvedAt: new Date(now).toISOString(),
  };
  const written = await ctx.deps.store.set(pairingKey(code), approved, { onlyIfMatch: doc.etag });
  if (!written) throw new ApiError(409, 'CONFLICT', 'The code changed meanwhile, try again');
  return json({ status: 'approved', deviceId: approved.deviceId, deviceName: approved.deviceName });
}

/** Watch: polls with its pollToken until the owner approves; then receives its deviceKey once. */
export async function pollPairing(ctx: Ctx): Promise<Response> {
  const now = ctx.deps.now();
  await consume(ctx.deps.store, LIMIT_RULES.pairingPoll, ctx.ip, now);
  const body = await readJson(ctx.req);
  const code = normalizePairingCode(body.code);
  if (!code || typeof body.pollToken !== 'string') throw badRequest('code and pollToken are required');
  const doc = await ctx.deps.store.get<PairingDoc>(pairingKey(code));
  // Same answer for "no such code" and "wrong token": nothing to learn by guessing.
  if (!doc || !safeEqual(doc.data.pollTokenHash, sha256(body.pollToken))) throw notFound('Pairing code');
  const pairing = doc.data;

  if (pairing.status === 'claimed') throw gone('This code was already used', 'CODE_USED');
  if (pairing.status === 'pending') {
    if (Date.parse(pairing.expiresAt) <= now) throw gone('This code has expired', 'CODE_EXPIRED');
    return json({ status: 'pending', expiresAt: pairing.expiresAt, pollIntervalSeconds: POLL_INTERVAL_SECONDS }, 202);
  }

  // Approved: claim it first (single use), then create the device key.
  const { keyId, deviceKey, secretHash } = createDeviceKey();
  const nowIso = new Date(now).toISOString();
  const claimed = await ctx.deps.store.set(
    pairingKey(code),
    { ...pairing, status: 'claimed', claimedAt: nowIso, keyId },
    { onlyIfMatch: doc.etag },
  );
  if (!claimed) throw gone('This code was already used', 'CODE_USED');

  // A watch that pairs again replaces its previous keys.
  for (const key of await ctx.deps.store.list('devices/')) {
    await update<DeviceRecord>(ctx.deps.store, key, (current) =>
      current && current.deviceId === pairing.deviceId && !current.revokedAt ? { ...current, revokedAt: nowIso } : undefined,
    );
  }
  const record: DeviceRecord = {
    keyId,
    deviceId: pairing.deviceId,
    deviceName: pairing.deviceName,
    secretHash,
    createdAt: nowIso,
    lastSeenAt: null,
    revokedAt: null,
  };
  await ctx.deps.store.set(deviceKeyPath(keyId), record, { onlyIfNew: true });
  return json({ status: 'approved', deviceKey, keyId, deviceId: pairing.deviceId, deviceName: pairing.deviceName });
}

// --- Devices --------------------------------------------------------------

export async function listDevices(ctx: Ctx): Promise<Response> {
  await requireOwner(ctx);
  const devices = [];
  for (const key of await ctx.deps.store.list('devices/')) {
    const doc = await ctx.deps.store.get<DeviceRecord>(key);
    if (!doc) continue;
    const { secretHash: _hidden, ...visible } = doc.data;
    devices.push(visible);
  }
  devices.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return json({ devices });
}

export async function revokeDevice(ctx: Ctx): Promise<Response> {
  await requireOwner(ctx);
  const keyId = ctx.params.keyId ?? '';
  if (!/^[0-9a-f]{16}$/.test(keyId)) throw notFound('Device');
  const nowIso = new Date(ctx.deps.now()).toISOString();
  await update<DeviceRecord>(ctx.deps.store, deviceKeyPath(keyId), (current) => {
    if (!current) throw notFound('Device');
    return current.revokedAt ? undefined : { ...current, revokedAt: nowIso };
  });
  return noContent();
}
