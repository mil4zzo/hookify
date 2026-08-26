do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
