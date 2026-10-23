-- ArbitrajeRemoto: dedicated database user for the API (`arbitraje_app`).
-- Safe to run more than once.
--
-- The API never uses the `postgres` user. It connects as `arbitraje_app`, which can only
-- read and write the tables of the private `arbitraje` schema: it cannot create or drop
-- tables, and it has no access to other schemas. This lets ArbitrajeRemoto share a
-- Supabase project with another app without being able to see that app's data.
--
-- The password is NOT set here (it must never be in the repository). After running this
-- migration, set it once in the Supabase SQL Editor (see docs/DESPLIEGUE.md):
--   alter role arbitraje_app with login password '<value from npm run gen-secret>';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'arbitraje_app') then
    create role arbitraje_app nologin noinherit nocreatedb nocreaterole;
  end if;
end
$$;

-- Keep a stuck query from holding the single serverless connection.
alter role arbitraje_app set statement_timeout = '10s';

grant usage on schema arbitraje to arbitraje_app;
grant select, insert, update, delete on
  arbitraje.matches, arbitraje.events, arbitraje.teams, arbitraje.devices,
  arbitraje.pairing_codes, arbitraje.rate_limits, arbitraje.meta
  to arbitraje_app;
-- Tables added by later migrations (run as the owner) get the same rights.
alter default privileges in schema arbitraje grant select, insert, update, delete on tables to arbitraje_app;

-- RLS stays enabled on every table. The only policies are for this server role:
-- the public API roles (anon, authenticated) still get nothing.
do $$
declare
  t text;
begin
  foreach t in array array['matches', 'events', 'teams', 'devices', 'pairing_codes', 'rate_limits', 'meta'] loop
    execute format('drop policy if exists arbitraje_app_all on arbitraje.%I', t);
    execute format(
      'create policy arbitraje_app_all on arbitraje.%I for all to arbitraje_app using (true) with check (true)', t);
  end loop;
end
$$;
