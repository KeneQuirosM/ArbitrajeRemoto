-- ArbitrajeRemoto: initial schema (Supabase Postgres).
-- Safe to run more than once. Apply with `npm run db:migrate` or paste it into the
-- Supabase SQL Editor (see docs/DESPLIEGUE.md).
--
-- Everything lives in a private schema that the Supabase Data API does not expose.
-- Row Level Security is enabled on every table WITHOUT policies, and the API roles
-- (anon, authenticated) get no privileges: only the server (connection string kept in
-- Vercel environment variables) can read or write.
--
-- Each table keeps a `version` column: it is the ETag used for optimistic concurrency
-- by server/pgstore.ts (a write only applies if the version it read is still current).

create schema if not exists arbitraje;

-- Matches. `data` holds the Match object; `summary` is the entry shown in the match
-- list (null when the match is not listed, e.g. deleted).
create table if not exists arbitraje.matches (
  id uuid primary key,
  data jsonb not null,
  live_token text not null,
  creation_fingerprint text not null,
  last_seq integer not null default 0 check (last_seq >= 0),
  deleted_at timestamptz,
  summary jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now()
);

-- Events: immutable, append-only. A resent event is ignored by
-- INSERT ... ON CONFLICT (match_id, id) DO NOTHING. `seq` is assigned by the server.
create table if not exists arbitraje.events (
  match_id uuid not null references arbitraje.matches (id) on delete cascade,
  id uuid not null,
  seq integer not null check (seq > 0),
  type text not null check (type in (
    'goal', 'own_goal', 'yellow_card', 'red_card', 'substitution', 'note',
    'period_start', 'period_pause', 'period_resume', 'period_end',
    'added_time', 'match_end', 'void'
  )),
  team text check (team in ('home', 'away')),
  player_number smallint check (player_number between 1 and 99),
  player_out_number smallint check (player_out_number between 1 and 99),
  player_in_number smallint check (player_in_number between 1 and 99),
  text text check (char_length(text) <= 500),
  voids_event_id uuid,
  period smallint check (period between 1 and 4),
  minutes smallint check (minutes between 0 and 30),
  client_timestamp timestamptz not null,
  match_minute smallint,
  device_id text not null check (char_length(device_id) between 1 and 64),
  created_at timestamptz not null,
  clock_offset_ms bigint not null default 0,
  t bigint not null,
  primary key (match_id, id),
  unique (match_id, seq)
);

-- Teams (rosters).
create table if not exists arbitraje.teams (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 60),
  players jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- Paired watches. Only a SHA-256 of each device key is stored (inside `data`).
create table if not exists arbitraje.devices (
  key_id text primary key check (key_id ~ '^[0-9a-f]{16}$'),
  device_id text not null,
  data jsonb not null,
  revoked_at timestamptz,
  version bigint not null default 1
);

-- One-time pairing codes (10 minutes).
create table if not exists arbitraje.pairing_codes (
  code text primary key check (code ~ '^[A-Z2-9]{6}$'),
  data jsonb not null,
  expires_at timestamptz not null,
  version bigint not null default 1
);

-- Fixed-window rate limits per bucket and hashed client IP.
create table if not exists arbitraje.rate_limits (
  bucket text not null,
  client_hash text not null,
  data jsonb not null,
  version bigint not null default 1,
  primary key (bucket, client_hash)
);

-- Version counters for documents that span several rows (the team list, the match list).
create table if not exists arbitraje.meta (
  key text primary key,
  version bigint not null default 1
);

create index if not exists matches_listed_idx on arbitraje.matches ((summary is not null)) where summary is not null;
create index if not exists pairing_codes_expires_idx on arbitraje.pairing_codes (expires_at);

-- Row Level Security on, no policies: nobody but the table owner (the server) gets rows.
alter table arbitraje.matches enable row level security;
alter table arbitraje.events enable row level security;
alter table arbitraje.teams enable row level security;
alter table arbitraje.devices enable row level security;
alter table arbitraje.pairing_codes enable row level security;
alter table arbitraje.rate_limits enable row level security;
alter table arbitraje.meta enable row level security;

-- Supabase API roles get nothing (they do not exist in a plain local Postgres).
do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on schema arbitraje from %I', api_role);
      execute format('revoke all on all tables in schema arbitraje from %I', api_role);
      execute format('alter default privileges in schema arbitraje revoke all on tables from %I', api_role);
    end if;
  end loop;
end
$$;
