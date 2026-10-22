// Key-value storage with optimistic concurrency (ETags).
// Production uses Netlify Blobs; tests use MemoryStore; the local dev server uses FileStore.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Store as BlobStore } from '@netlify/blobs';

export interface Doc<T> {
  data: T;
  etag: string;
}

export interface WriteOptions {
  /** Write only if the key does not exist yet. */
  onlyIfNew?: boolean;
  /** Write only if the current ETag equals this value. */
  onlyIfMatch?: string;
}

export interface KVStore {
  get<T>(key: string): Promise<Doc<T> | null>;
  /** Returns false when a conditional write did not apply. */
  set(key: string, value: unknown, options?: WriteOptions): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export class ConflictRetriesExhausted extends Error {}

/**
 * Read-modify-write with optimistic concurrency. `fn` receives the current value
 * (null if missing) and returns the new value, or `undefined` to leave it unchanged.
 * `fn` may run several times, so it must be free of side effects.
 */
export async function update<T>(
  store: KVStore,
  key: string,
  fn: (current: T | null) => T | undefined,
  maxAttempts = 8,
): Promise<{ value: T | null; changed: boolean }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const doc = await store.get<T>(key);
    const next = fn(doc ? doc.data : null);
    if (next === undefined) return { value: doc ? doc.data : null, changed: false };
    const written = doc
      ? await store.set(key, next, { onlyIfMatch: doc.etag })
      : await store.set(key, next, { onlyIfNew: true });
    if (written) return { value: next, changed: true };
    if (attempt > 0) await new Promise((r) => setTimeout(r, Math.random() * 20 * attempt));
  }
  throw new ConflictRetriesExhausted(`Too many concurrent writes on ${key}`);
}

export class MemoryStore implements KVStore {
  protected data = new Map<string, { json: string; etag: string }>();
  private counter = 0;
  /** Test hook: runs right before each conditional write (to simulate a concurrent writer). */
  beforeWrite: ((key: string) => Promise<void> | void) | null = null;

  async get<T>(key: string): Promise<Doc<T> | null> {
    const entry = this.data.get(key);
    return entry ? { data: JSON.parse(entry.json) as T, etag: entry.etag } : null;
  }

  async set(key: string, value: unknown, options: WriteOptions = {}): Promise<boolean> {
    if (this.beforeWrite && (options.onlyIfMatch || options.onlyIfNew)) {
      const hook = this.beforeWrite;
      this.beforeWrite = null;
      await hook(key);
    }
    const current = this.data.get(key);
    if (options.onlyIfNew && current) return false;
    if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return false;
    this.data.set(key, { json: JSON.stringify(value), etag: `"${++this.counter}"` });
    this.persist();
    return true;
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
    this.persist();
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  protected persist(): void {}
}

/** MemoryStore persisted to a JSON file. Single process only (local development). */
export class FileStore extends MemoryStore {
  private readonly path: string;

  constructor(path: string) {
    super();
    this.path = path;
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { json: string; etag: string }>;
      this.data = new Map(Object.entries(saved));
    } catch {
      // No saved data yet.
    }
  }

  protected override persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.data)));
  }
}

export class BlobsStore implements KVStore {
  private readonly blobs: BlobStore;

  constructor(blobs: BlobStore) {
    this.blobs = blobs;
  }

  async get<T>(key: string): Promise<Doc<T> | null> {
    const result = await this.blobs.getWithMetadata(key, { type: 'json' });
    if (!result) return null;
    return { data: result.data as T, etag: result.etag ?? '' };
  }

  async set(key: string, value: unknown, options: WriteOptions = {}): Promise<boolean> {
    const conditions = options.onlyIfNew
      ? { onlyIfNew: true as const }
      : options.onlyIfMatch
        ? { onlyIfMatch: options.onlyIfMatch }
        : {};
    const result = await this.blobs.setJSON(key, value, conditions);
    return result.modified;
  }

  async delete(key: string): Promise<void> {
    await this.blobs.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const { blobs } = await this.blobs.list({ prefix });
    return blobs.map((b) => b.key).sort();
  }
}
