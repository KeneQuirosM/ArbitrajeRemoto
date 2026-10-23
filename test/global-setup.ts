// Vitest global setup: when TEST_DATABASE_URL is set, builds a migrated template database
// that every Postgres-backed test copies, and removes the copies at the end.

import { migrate } from '../scripts/migrate.ts';
import { createSql } from '../server/db.ts';
import { PG_URL, TEMPLATE_DB, databaseUrl } from './pg.ts';

async function dropTestDatabases(): Promise<void> {
  const admin = createSql(PG_URL!);
  try {
    const rows = await admin<{ datname: string }[]>`
      select datname from pg_database where datname like 'arb_t\\_%' or datname = ${TEMPLATE_DB}`;
    for (const { datname } of rows) await admin.unsafe(`drop database if exists ${datname} with (force)`);
  } finally {
    await admin.end();
  }
}

export async function setup(): Promise<void> {
  if (!PG_URL) return;
  await dropTestDatabases();
  const admin = createSql(PG_URL);
  try {
    await admin.unsafe(`create database ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  await migrate(databaseUrl(TEMPLATE_DB), () => {});
}

export async function teardown(): Promise<void> {
  if (PG_URL) await dropTestDatabases();
}
