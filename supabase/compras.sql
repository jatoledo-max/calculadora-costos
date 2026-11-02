-- Compras del día a día (carnicería, verdulería, mayorista…). Pestaña Compras de la app.
-- Pegar entero en Supabase > SQL Editor y correr (se puede correr más de una vez; no borra nada).
-- Necesita schema.sql (usa negocios y puede_usar). Cada compra se descuenta de la caja abierta con
-- registrar_movimiento de caja.sql (tipo compra_mercaderia, efectivo o transferencia, mismo id que la compra).
-- Lo que la app aprende (último precio por kilo de cada cosa, las categorías) va en la tabla ajustes, id "compras".

create table if not exists public.compras (
  id uuid primary key,                            -- lo genera el celular: un reintento no duplica
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  fecha date not null,
  categoria text not null check (length(btrim(categoria)) between 1 and 40),
  descripcion text not null check (length(btrim(descripcion)) between 1 and 120),
  importe numeric(12,2) not null check (importe > 0),
  cantidad numeric(12,3) check (cantidad > 0),    -- en kg, l o u; vacía si no se sabe
  unidad text check (unidad in ('kg', 'l', 'u')),
  estimada boolean not null default false,        -- true: la calculó la app con el último precio
  medio text not null default 'efectivo' check (medio in ('efectivo', 'transferencia')),
  en_caja boolean not null default false,         -- true: se descontó de la caja abierta (movimiento con el mismo id)
  creado_en timestamptz not null default now(),
  check ((cantidad is null) = (unidad is null))
);
alter table public.compras add column if not exists en_caja boolean not null default false;
alter table public.compras add column if not exists medio text not null default 'efectivo' check (medio in ('efectivo', 'transferencia'));
create index if not exists compras_por_fecha on public.compras (negocio_id, fecha desc);

alter table public.compras enable row level security;
revoke all on public.compras from anon;
grant select, insert, delete on public.compras to authenticated;
drop policy if exists "compras del negocio" on public.compras;
create policy "compras del negocio" on public.compras
  for all using (public.puede_usar(negocio_id)) with check (public.puede_usar(negocio_id));
