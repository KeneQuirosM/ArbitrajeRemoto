// Fixed-window rate limiting stored in the KV store, keyed by a hash of the client IP.
// Best effort: it protects the login and pairing endpoints from guessing, not from DDoS.

import { rateLimited } from './errors.ts';
import { sha256 } from './crypto.ts';
import { update, type KVStore } from './store.ts';

export interface LimitRule {
  bucket: string;
  limit: number;
  windowMs: number;
}

export const LIMIT_RULES = {
  loginFailures: { bucket: 'login', limit: 5, windowMs: 15 * 60_000 },
  pairingRequest: { bucket: 'pair-request', limit: 10, windowMs: 10 * 60_000 },
  pairingPoll: { bucket: 'pair-poll', limit: 240, windowMs: 10 * 60_000 },
  pairingApproveFailures: { bucket: 'pair-approve', limit: 10, windowMs: 10 * 60_000 },
} satisfies Record<string, LimitRule>;

interface Counter {
  windowStart: number;
  count: number;
}

const keyFor = (rule: LimitRule, client: string) => `ratelimit/${rule.bucket}/${sha256(client).slice(0, 32)}`;

/** Throws 429 if the client already reached the limit in the current window. */
export async function assertUnderLimit(store: KVStore, rule: LimitRule, client: string, nowMs: number): Promise<void> {
  const doc = await store.get<Counter>(keyFor(rule, client));
  if (!doc) return;
  const { windowStart, count } = doc.data;
  if (nowMs - windowStart < rule.windowMs && count >= rule.limit) {
    throw rateLimited(Math.ceil((windowStart + rule.windowMs - nowMs) / 1000));
  }
}

/** Counts one hit. */
export async function recordHit(store: KVStore, rule: LimitRule, client: string, nowMs: number): Promise<void> {
  await update<Counter>(store, keyFor(rule, client), (current) => {
    if (!current || nowMs - current.windowStart >= rule.windowMs) return { windowStart: nowMs, count: 1 };
    return { windowStart: current.windowStart, count: current.count + 1 };
  });
}

/** Checks and counts in one step (for endpoints where every call counts). */
export async function consume(store: KVStore, rule: LimitRule, client: string, nowMs: number): Promise<void> {
  await assertUnderLimit(store, rule, client, nowMs);
  await recordHit(store, rule, client, nowMs);
}
