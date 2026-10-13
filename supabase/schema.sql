-- Esquema de la Calculadora de Costos.
-- Pegar entero en Supabase > SQL Editor > New query > Run.
-- Cada usuario tiene un negocio; cada negocio ve solo sus insumos y productos,
-- y solo mientras tenga la prueba gratis vigente o la suscripción activa.

create table if not exists public.negocios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  nombre text not null,
  logo text,                          -- imagen chica en data URL (la app la achica antes de guardar)
  color text default '#b77900',       -- color principal de la marca del negocio
  prueba_hasta timestamptz not null default now() + interval '14 days',
  suscripcion_estado text not null default 'sin_suscripcion', -- authorized | paused | cancelled | pending | sin_suscripcion
  mp_preapproval_id text,
  creado timestamptz not null default now()
);

create table if not exists public.insumos (
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  id text not null,
  datos jsonb not null,
  actualizado timestamptz not null default now(),
  primary key (negocio_id, id)
);

create table if not exists public.productos (
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  id text not null,
  datos jsonb not null,
  actualizado timestamptz not null default now(),
  primary key (negocio_id, id)
);

-- ¿El negocio puede usar la app ahora?
create or replace function public.negocio_activo(n public.negocios)
returns boolean language sql stable as $$
  select n.suscripcion_estado = 'authorized' or n.prueba_hasta > now();
$$;

-- ¿Este negocio es del usuario que hace la consulta y está activo?
create or replace function public.puede_usar(neg uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.negocios n
    where n.id = neg and n.owner_id = auth.uid() and public.negocio_activo(n)
  );
$$;

alter table public.negocios enable row level security;
alter table public.insumos enable row level security;
alter table public.productos enable row level security;

drop policy if exists "dueño ve su negocio" on public.negocios;
create policy "dueño ve su negocio" on public.negocios
  for select using (owner_id = auth.uid());
drop policy if exists "dueño crea su negocio" on public.negocios;
create policy "dueño crea su negocio" on public.negocios
  for insert with check (owner_id = auth.uid());
drop policy if exists "dueño edita su negocio" on public.negocios;
create policy "dueño edita su negocio" on public.negocios
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- El usuario solo puede tocar nombre, logo y color. La prueba y la suscripción
-- las cambia únicamente el servidor (función de Mercado Pago con la service key).
revoke insert, update on public.negocios from anon, authenticated;
grant insert (nombre, logo, color) on public.negocios to authenticated;
grant update (nombre, logo, color) on public.negocios to authenticated;

drop policy if exists "insumos del negocio" on public.insumos;
create policy "insumos del negocio" on public.insumos
  for all using (public.puede_usar(negocio_id)) with check (public.puede_usar(negocio_id));
drop policy if exists "productos del negocio" on public.productos;
create policy "productos del negocio" on public.productos
  for all using (public.puede_usar(negocio_id)) with check (public.puede_usar(negocio_id));
