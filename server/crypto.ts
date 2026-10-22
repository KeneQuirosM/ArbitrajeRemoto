// Secrets handling: passphrase hashing, signed session cookies, device keys, random tokens.

import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, keyLength: 32, maxmem: 64 * 1024 * 1024 };

export const MIN_PASSPHRASE_LENGTH = 12;

/** Format: scrypt$N$r$p$<salt base64url>$<hash base64url> */
export function hashPassphrase(passphrase: string, salt = randomBytes(16)): string {
  const hash = scryptSync(passphrase.normalize('NFC'), salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export function isValidPassphraseHash(stored: string | undefined): boolean {
  return typeof stored === 'string' && /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(stored);
}

export function verifyPassphrase(passphrase: string, stored: string): boolean {
  if (!isValidPassphraseHash(stored)) return false;
  const [, n, r, p, saltB64, hashB64] = stored.split('$') as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = scryptSync(passphrase.normalize('NFC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(actual, expected);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// --- Owner session cookie -------------------------------------------------

export const SESSION_COOKIE = 'ar_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_SESSION_SECRET_LENGTH = 32;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Value: v1.<expiresAtMs>.<nonce>.<hmac> */
export function createSessionToken(secret: string, nowMs: number): string {
  const payload = `v1.${nowMs + SESSION_TTL_MS}.${randomToken(12)}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, nowMs: number): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const payload = parts.slice(0, 3).join('.');
  if (!safeEqual(sign(payload, secret), parts[3]!)) return false;
  const expiresAt = Number(parts[1]);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

// --- Device keys ----------------------------------------------------------

const DEVICE_KEY_RE = /^ark1_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

/** Format: ark1_<keyId: 16 hex>_<secret: 32 random bytes base64url>. Only the secret's SHA-256 is stored. */
export function createDeviceKey(): { keyId: string; deviceKey: string; secretHash: string } {
  const keyId = randomBytes(8).toString('hex');
  const secret = randomToken(32);
  return { keyId, deviceKey: `ark1_${keyId}_${secret}`, secretHash: sha256(secret) };
}

export function parseDeviceKey(value: string): { keyId: string; secretHash: string } | null {
  const match = DEVICE_KEY_RE.exec(value);
  if (!match) return null;
  return { keyId: match[1]!, secretHash: sha256(match[2]!) };
}

// --- Pairing codes --------------------------------------------------------

/** No 0/O, 1/I/L: easy to read on a watch and to type on a phone. */
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 6;

export function createPairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  return code;
}

/** Uppercases and drops spaces/dashes. Returns null if it cannot be a valid code. */
export function normalizePairingCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== PAIRING_CODE_LENGTH) return null;
  for (const ch of code) if (!PAIRING_ALPHABET.includes(ch)) return null;
  return code;
}
