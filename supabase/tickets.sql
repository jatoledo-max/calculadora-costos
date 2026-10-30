-- Tickets de pedido: el negocio arma el pedido que el cliente le pidió por WhatsApp y le manda un link.
-- El cliente abre el link, ve el detalle con los precios y responde: acepta, pide un cambio o rechaza.
-- Pegar entero en Supabase > SQL Editor y correr (se puede correr más de una vez; no borra nada).
-- Necesita schema.sql, caja.sql y menu.sql.
--
--   guardar_ticket(...)          → el dueño (con login) crea o corrige un ticket. Los precios los pone la base.
--   ver_ticket(token)            → el cliente (sin login) ve su ticket. Solo ese: hay que tener el link.
--   responder_ticket(token, ...) → el cliente acepta, pide un cambio o rechaza.
-- El ticket NO es una venta: la venta se guarda en la Caja cuando el negocio cobra.

create table if not exists public.tickets (
  id uuid primary key,                           -- lo genera el celular: un reintento no duplica
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  numero int not null,
  token text not null unique,                    -- lo que va en el link; no se puede adivinar
  cliente text,                                  -- para reconocerlo en la lista (opcional)
  items jsonb not null,                          -- [{ producto, opcion, nombre, opcion_nombre, cantidad, precio_unitario, subtotal }]
  envio numeric(12,2) check (envio >= 0),        -- null = retira en el local
  nota text,
  subtotal numeric(12,2) not null,
  total numeric(12,2) not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptado', 'cambio', 'rechazado')),
  respuesta text,                                -- qué quiere cambiar el cliente
  respondido_en timestamptz,
  version int not null default 1,                -- sube cada vez que el negocio corrige el ticket
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (negocio_id, numero)
);
create index if not exists tickets_recientes on public.tickets (negocio_id, creado_en desc);

-- El celular solo lee; escribe con las funciones de abajo.
alter table public.tickets enable row level security;
revoke all on public.tickets from anon, authenticated;
grant select on public.tickets to authenticated;
drop policy if exists "tickets del negocio" on public.tickets;
create policy "tickets del negocio" on public.tickets for select using (public.puede_usar(negocio_id));

-- Crea el ticket, o lo corrige si ya existe (mismo link). Uno aceptado o rechazado ya no se toca.
-- p_items: [{ "producto": id, "opcion": id o null, "cantidad": entero }]   p_envio: null si retira.
create or replace function public.guardar_ticket(p_id uuid, p_items jsonb, p_envio numeric, p_cliente text default null, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  neg uuid := public.caja_mi_negocio();
  t public.tickets; it jsonb; d jsonb; op jsonb;
  cant int; unit numeric; renglones jsonb := '[]'; sub numeric := 0;
begin
  if p_id is null then raise exception 'Falta el id del ticket.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agregá al menos un producto.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'El ticket tiene demasiados renglones.'; end if;
  if p_envio is not null and (p_envio < 0 or p_envio > 1000000) then raise exception 'Revisá el monto del envío.'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(it->>'cantidad', '') !~ '^\d{1,3}$' or (it->>'cantidad')::int not between 1 and 999 then
      raise exception 'Revisá las cantidades.';
    end if;
    cant := (it->>'cantidad')::int;
    select p.datos into d from public.productos p where p.negocio_id = neg and p.id = it->>'producto';
    if d is null or coalesce((d->>'esPreparacion')::boolean, false) then raise exception 'Uno de los productos ya no existe.'; end if;
    if coalesce(d->>'precioVenta', '') !~ '^\d+(\.\d+)?$' or (d->>'precioVenta')::numeric <= 0 then
      raise exception '"%" no tiene precio de venta.', d->>'nombre';
    end if;
    op := null;
    if coalesce(it->>'opcion', '') <> '' then
      select x.o into op from jsonb_array_elements(case when jsonb_typeof(d->'opciones') = 'array' then d->'opciones' else '[]' end) x(o)
      where x.o->>'id' = it->>'opcion';
      if op is null then raise exception 'La opción elegida de "%" ya no existe.', d->>'nombre'; end if;
    end if;
    unit := round((d->>'precioVenta')::numeric + greatest(coalesce((op->>'precioExtra')::numeric, 0), 0), 2);
    sub := sub + unit * cant;
    renglones := renglones || jsonb_build_object(
      'producto', it->>'producto', 'opcion', op->>'id', 'nombre', btrim(d->>'nombre'), 'opcion_nombre', btrim(op->>'nombre'),
      'cantidad', cant, 'precio_unitario', unit, 'subtotal', unit * cant);
  end loop;

  select * into t from public.tickets where id = p_id for update;
  if found then
    if t.negocio_id <> neg then raise exception 'Ese ticket no es de tu negocio.'; end if;
    if t.estado in ('aceptado', 'rechazado') then raise exception 'El cliente ya respondió este ticket. Armá uno nuevo.'; end if;
    update public.tickets set items = renglones, envio = round(p_envio, 2), cliente = nullif(btrim(coalesce(p_cliente, '')), ''),
      nota = nullif(btrim(coalesce(p_nota, '')), ''), subtotal = sub, total = sub + coalesce(round(p_envio, 2), 0),
      estado = 'pendiente', version = t.version + 1, actualizado_en = now()
    where id = p_id returning * into t;
  else
    perform 1 from public.negocios where id = neg for update;   -- numeración sin saltos ni repetidos
    insert into public.tickets (id, negocio_id, numero, token, cliente, items, envio, nota, subtotal, total)
    values (p_id, neg, coalesce((select max(numero) from public.tickets where negocio_id = neg), 0) + 1,
      translate(encode(uuid_send(gen_random_uuid()), 'base64'), '+/=', '-_'),
      nullif(btrim(coalesce(p_cliente, '')), ''), renglones, round(p_envio, 2), nullif(btrim(coalesce(p_nota, '')), ''),
      sub, sub + coalesce(round(p_envio, 2), 0))
    returning * into t;
  end if;
  return to_jsonb(t);
end $$;

-- Lo que ve el cliente: su ticket y los datos para pagar. Nunca costos, recetas ni otros tickets.
create or replace function public.ver_ticket(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.tickets; n public.negocios; m jsonb;
begin
  select * into t from public.tickets where token = btrim(coalesce(p_token, ''));
  if not found then return null; end if;
  select * into n from public.negocios where id = t.negocio_id;
  if not public.negocio_activo(n) then return null; end if;
  select datos into m from public.ajustes where negocio_id = n.id and id = 'menu';
  return jsonb_build_object(
    'negocio', jsonb_build_object('nombre', n.nombre, 'logo', n.logo, 'color', n.color),
    'pago', (public.menu_config(coalesce(m, '{}'::jsonb))) - 'horarios' - 'aviso' - 'envio',
    'ticket', jsonb_build_object('numero', t.numero, 'cliente', t.cliente, 'items', t.items, 'envio', t.envio, 'nota', t.nota,
      'subtotal', t.subtotal, 'total', t.total, 'estado', t.estado, 'respuesta', t.respuesta, 'respondido_en', t.respondido_en,
      'version', t.version, 'actualizado_en', t.actualizado_en));
end $$;

-- El cliente responde. p_version: la versión que estaba mirando (si el negocio la corrigió en el medio, se le avisa).
create or replace function public.responder_ticket(p_token text, p_estado text, p_version int, p_respuesta text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tickets; n public.negocios;
begin
  select * into t from public.tickets where token = btrim(coalesce(p_token, '')) for update;
  if not found then raise exception 'Este ticket no existe.'; end if;
  select * into n from public.negocios where id = t.negocio_id;
  if not public.negocio_activo(n) then raise exception 'Este ticket no está disponible.'; end if;
  if p_estado not in ('aceptado', 'cambio', 'rechazado') then raise exception 'Respuesta no válida.'; end if;
  if t.estado = p_estado and t.version = p_version then return public.ver_ticket(p_token); end if;   -- doble toque
  if t.estado <> 'pendiente' then raise exception 'Este ticket ya fue respondido.'; end if;
  if t.version <> p_version then raise exception 'El negocio corrigió el ticket. Mirá el nuevo detalle antes de responder.'; end if;
  if p_estado = 'cambio' and coalesce(btrim(p_respuesta), '') = '' then raise exception 'Escribí qué querés cambiar.'; end if;
  update public.tickets set estado = p_estado, respondido_en = now(),
    respuesta = case when p_estado = 'aceptado' then null else left(nullif(btrim(coalesce(p_respuesta, '')), ''), 500) end
  where id = t.id;
  return public.ver_ticket(p_token);
end $$;

revoke all on function public.guardar_ticket(uuid, jsonb, numeric, text, text) from public, anon;
revoke all on function public.ver_ticket(text) from public;
revoke all on function public.responder_ticket(text, text, int, text) from public;
grant execute on function public.guardar_ticket(uuid, jsonb, numeric, text, text) to authenticated;
grant execute on function public.ver_ticket(text) to anon, authenticated;
grant execute on function public.responder_ticket(text, text, int, text) to anon, authenticated;
