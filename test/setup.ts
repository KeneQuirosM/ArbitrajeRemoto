// Per-file setup: close the Postgres connections opened by the tests (no-op without Postgres).
import { afterAll } from 'vitest';
import { closeAll } from './pg.ts';

afterAll(closeAll);
