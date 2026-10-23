// Test helpers for the Postgres store. Needs a reachable Postgres server:
//   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres
// Each call to freshDatabase() creates an isolated database from a migrated template.

import { randomBytes } from 'node:crypto';
import { createSql, type Sql } from '../server/db.ts';
import type { Doc, KVStore, WriteOptions } from '../server/store.ts';
import { PostgresStore } from '../server/pgstore.ts';

export const PG_URL = process.env.TEST_DATABASE_URL;
export const TEMPLATE_DB = 'arb_test_template';

export function databaseUrl(name: string): string {
  const url = new URL(PG_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

const open: Sql[] = [];

export async function freshDatabase(): Promise<{ url: string; sql: Sql }> {
  const name = `arb_t_${randomBytes(6).toString('hex')}`;
  const admin = createSql(PG_URL!);
  try {
    await admin.unsafe(`create database ${name} template ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  const url = databaseUrl(name);
  const sql = createSql(url);
  open.push(sql);
  return { url, sql };
}

export async function closeAll(): Promise<void> {
  await Promise.all(open.splice(0).map((sql) => sql.end({ timeout: 1 })));
}

/**
 * A PostgresStore on its own fresh database, usable synchronously: every call waits
 * for the database to exist. Same `beforeWrite` test hook as MemoryStore.
 */
export class LazyPostgresStore implements KVStore {
  private readonly ready: Promise<PostgresStore>;
  beforeWrite: ((key: string) => Promise<void> | void) | null = null;
  sql: Promise<Sql>;

  constructor() {
    const db = freshDatabase();
    this.sql = db.then((d) => d.sql);
    this.ready = db.then((d) => new PostgresStore(d.sql));
  }

  async get<T>(key: string): Promise<Doc<T> | null> {
    return (await this.ready).get<T>(key);
  }

  async set(key: string, value: unknown, options: WriteOptions = {}): Promise<boolean> {
    if (this.beforeWrite && (options.onlyIfMatch || options.onlyIfNew)) {
      const hook = this.beforeWrite;
      this.beforeWrite = null;
      await hook(key);
    }
    return (await this.ready).set(key, value, options);
  }

  async delete(key: string): Promise<void> {
    return (await this.ready).delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return (await this.ready).list(prefix);
  }
}
