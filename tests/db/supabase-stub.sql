-- Imita lo mínimo de Supabase para probar schema.sql y caja.sql en un Postgres común:
-- los roles anon y authenticated, la tabla auth.users y auth.uid() (el usuario que hace el pedido).
-- En las pruebas, el usuario se elige con: select set_config('request.jwt.claim.sub', '<uuid>', false);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
