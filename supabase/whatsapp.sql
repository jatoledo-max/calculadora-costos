-- Asistente de WhatsApp: charlas con clientes, pedidos que arma el asistente y su estado.
-- Pegar entero en Supabase > SQL Editor y correr (se puede correr más de una vez; no borra nada).
-- Necesita schema.sql y menu.sql (el asistente cotiza con cotizar_pedido, la misma regla de precios del menú online).
--
-- Quién escribe qué:
--   el servidor (netlify/functions/whatsapp.mjs, con la service key) guarda charlas, mensajes y pedidos nuevos;
--   el dueño, desde la pestaña Pedidos, ve sus pedidos y charlas, y cambia el estado con pedido-estado.mjs
--   (que además le avisa al cliente por WhatsApp). El navegador no puede inventar pedidos ni importes.
--
-- Ajustes id 'whatsapp' (pestaña Pedidos): { activo: true/false } enciende o apaga el asistente.

-- Una charla por cliente. historial: lo que se habló, en el formato de la IA (se recorta solo).
create table if not exists public.wa_charlas (
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  telefono text not null,                -- wa_id del cliente, ej 5493855000000
  nombre text,                           -- nombre de perfil de WhatsApp
  historial jsonb not null default '[]',
  historial_en timestamptz,              -- cuándo se contestó por última vez (pasadas unas horas, charla nueva)
  ubicacion jsonb,                       -- última ubicación que mandó { lat, lng, nombre, direccion }
  pausada_hasta timestamptz,             -- mientras sea futuro el asistente no contesta (lo atiende el dueño)
  necesita_humano text,                  -- motivo por el que el asistente pidió ayuda; null = no
  cerrado_avisado_en timestamptz,        -- último "estamos cerrados", para no repetirlo en cada mensaje
  pendientes jsonb not null default '[]', -- mensajes que llegaron seguidos y todavía no se contestaron
  contestando_hasta timestamptz,         -- mientras sea futuro, la IA está armando una respuesta para esta charla
  ultimo_mensaje_en timestamptz not null default now(),   -- del cliente: abre la ventana de 24 h de WhatsApp
  primary key (negocio_id, telefono)
);

-- Columnas agregadas después de la primera versión (si la tabla ya existía).
alter table public.wa_charlas add column if not exists historial_en timestamptz;
alter table public.wa_charlas add column if not exists pendientes jsonb not null default '[]';
alter table public.wa_charlas add column if not exists contestando_hasta timestamptz;

-- Mensajes ya procesados: Meta puede mandar el mismo aviso más de una vez.
create table if not exists public.wa_mensajes (
  id text primary key,
  recibido timestamptz not null default now()
);

create table if not exists public.wa_pedidos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  numero int not null,
  telefono text not null,
  nombre text,
  renglones jsonb not null,              -- como los devuelve cotizar_pedido (precios de la base)
  subtotal numeric(12,2) not null,
  envio numeric(12,2),
  total numeric(12,2) not null,
  entrega text not null check (entrega in ('retiro', 'delivery')),
  pago text,
  ubicacion jsonb,
  direccion text,
  notas text,
  estado text not null default 'nuevo'
    check (estado in ('nuevo', 'aceptado', 'en_preparacion', 'en_camino', 'entregado', 'rechazado')),
  motivo_rechazo text,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  unique (negocio_id, numero)
);
-- Avisos al cliente que esperan salir por el bot de la PC (cuando no se usa la API de Meta).
-- Los escribe pedido-estado.mjs; el bot los manda y marca "enviado" (o "error" si no pudo).
create table if not exists public.wa_salida (
  id bigserial primary key,
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  telefono text not null,
  texto text not null,
  creado timestamptz not null default now(),
  enviado timestamptz,
  error text
);
create index if not exists wa_salida_pendientes on public.wa_salida (negocio_id, id) where enviado is null and error is null;

create index if not exists wa_pedidos_negocio_creado on public.wa_pedidos (negocio_id, creado desc);

alter table public.wa_charlas enable row level security;
alter table public.wa_mensajes enable row level security;
alter table public.wa_pedidos enable row level security;
alter table public.wa_salida enable row level security;

-- El dueño ve lo suyo. Los cambios pasan por el servidor (estado + aviso al cliente) o por estas columnas.
drop policy if exists "charlas del negocio" on public.wa_charlas;
create policy "charlas del negocio" on public.wa_charlas
  for select using (public.puede_usar(negocio_id));
drop policy if exists "dueño retoma charlas" on public.wa_charlas;
create policy "dueño retoma charlas" on public.wa_charlas
  for update using (public.puede_usar(negocio_id)) with check (public.puede_usar(negocio_id));
drop policy if exists "pedidos del negocio" on public.wa_pedidos;
create policy "pedidos del negocio" on public.wa_pedidos
  for select using (public.puede_usar(negocio_id));

revoke all on public.wa_charlas, public.wa_mensajes, public.wa_pedidos, public.wa_salida from anon, authenticated;
grant select on public.wa_charlas, public.wa_pedidos to authenticated;
-- Desde la app el dueño solo puede pausar/reactivar el asistente en una charla y marcarla como atendida.
grant update (pausada_hasta, necesita_humano) on public.wa_charlas to authenticated;

-- Lo que el asistente necesita saber del negocio en cada mensaje: el menú publicado y si está encendido.
-- null si el menú no está publicado o el negocio no está activo.
create or replace function public.wa_contexto(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare neg uuid; wa jsonb;
begin
  select x.negocio_id into neg from public.menu_negocio(p_slug) x;
  if neg is null then return null; end if;
  select datos into wa from public.ajustes where negocio_id = neg and id = 'whatsapp';
  return jsonb_build_object('negocio_id', neg, 'activo', coalesce((wa->>'activo')::boolean, false),
                            'publico', public.menu_publico(p_slug));
end $$;
revoke all on function public.wa_contexto(text) from public, anon, authenticated;

-- Los clientes suelen mandar varios mensajes seguidos ("hola", "quiero 2 lomitos", un audio).
-- Cada mensaje se encola acá; unos segundos después, solo el ÚLTIMO de la fila los toma todos y se contestan juntos.
create or replace function public.wa_encolar(p_negocio uuid, p_telefono text, p_nombre text, p_id text, p_texto text, p_ubicacion jsonb)
returns void language sql volatile security definer set search_path = public as $$
  insert into public.wa_charlas as c (negocio_id, telefono, nombre, ubicacion, pendientes, ultimo_mensaje_en)
  values (p_negocio, p_telefono, p_nombre, p_ubicacion, jsonb_build_array(jsonb_build_object('id', p_id, 'texto', p_texto)), now())
  on conflict (negocio_id, telefono) do update set
    nombre = coalesce(excluded.nombre, c.nombre),
    ubicacion = coalesce(excluded.ubicacion, c.ubicacion),
    pendientes = c.pendientes || excluded.pendientes,
    ultimo_mensaje_en = now();
$$;
revoke all on function public.wa_encolar(uuid, text, text, text, text, jsonb) from public, anon, authenticated;

-- Devuelve la charla con sus mensajes pendientes (y los saca de la fila) si p_id es el último que llegó; si no, null.
-- Una sola respuesta por charla a la vez: si la IA ya está contestando, los mensajes nuevos quedan en la fila
-- y los toma wa_soltar cuando esa respuesta termina (así no se cruzan dos respuestas).
create or replace function public.wa_tomar(p_negocio uuid, p_telefono text, p_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c public.wa_charlas;
begin
  select * into c from public.wa_charlas where negocio_id = p_negocio and telefono = p_telefono for update;
  if not found or jsonb_array_length(c.pendientes) = 0 or c.pendientes->-1->>'id' <> p_id then return null; end if;
  if c.contestando_hasta > now() then return null; end if;
  update public.wa_charlas set pendientes = '[]', contestando_hasta = now() + interval '2 minutes'
   where negocio_id = p_negocio and telefono = p_telefono;
  return to_jsonb(c);
end $$;
revoke all on function public.wa_tomar(uuid, text, text) from public, anon, authenticated;

-- Terminó una respuesta: si mientras tanto llegaron mensajes, los devuelve (con la charla ya actualizada)
-- para contestarlos enseguida; si no, libera la charla.
create or replace function public.wa_soltar(p_negocio uuid, p_telefono text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c public.wa_charlas;
begin
  select * into c from public.wa_charlas where negocio_id = p_negocio and telefono = p_telefono for update;
  if not found then return null; end if;
  if jsonb_array_length(c.pendientes) = 0 then
    update public.wa_charlas set contestando_hasta = null where negocio_id = p_negocio and telefono = p_telefono;
    return null;
  end if;
  update public.wa_charlas set pendientes = '[]', contestando_hasta = now() + interval '2 minutes'
   where negocio_id = p_negocio and telefono = p_telefono;
  return to_jsonb(c);
end $$;
revoke all on function public.wa_soltar(uuid, text) from public, anon, authenticated;

-- Guarda un pedido confirmado por el cliente. Recalcula con cotizar_pedido: el importe nunca lo pone la IA.
-- Si el mismo cliente confirma lo mismo dos veces seguidas (reintento), devuelve el pedido que ya estaba.
create or replace function public.wa_registrar_pedido(
  p_slug text, p_telefono text, p_nombre text, p_items jsonb, p_entrega text,
  p_pago text, p_ubicacion jsonb, p_direccion text, p_notas text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  neg uuid; cot jsonb; previo public.wa_pedidos; num int; nuevo public.wa_pedidos;
begin
  select x.negocio_id into neg from public.menu_negocio(p_slug) x;
  if neg is null then raise exception 'El menú no está disponible.'; end if;
  cot := public.cotizar_pedido(p_slug, p_items, p_entrega);
  if jsonb_array_length(cot->'errores') > 0 then
    return jsonb_build_object('ok', false, 'errores', cot->'errores');
  end if;
  if p_pago is not null and p_pago not in ('efectivo', 'transferencia', 'dividido') then
    raise exception 'Medio de pago desconocido.';
  end if;

  perform pg_advisory_xact_lock(hashtext('wa_pedido:' || neg::text));
  select * into previo from public.wa_pedidos
  where negocio_id = neg and telefono = p_telefono and estado = 'nuevo'
    and creado > now() - interval '15 minutes' and renglones = cot->'renglones' and entrega = p_entrega
  order by creado desc limit 1;
  if found then
    return jsonb_build_object('ok', true, 'numero', previo.numero, 'total', previo.total, 'repetido', true,
                              'envio_a_confirmar', previo.entrega = 'delivery' and previo.envio is null);
  end if;

  select coalesce(max(numero), 0) + 1 into num from public.wa_pedidos where negocio_id = neg;
  insert into public.wa_pedidos (negocio_id, numero, telefono, nombre, renglones, subtotal, envio, total,
                                 entrega, pago, ubicacion, direccion, notas)
  values (neg, num, p_telefono, nullif(btrim(coalesce(p_nombre, '')), ''), cot->'renglones',
          (cot->>'subtotal')::numeric, (cot->>'envio')::numeric, (cot->>'total')::numeric,
          p_entrega, p_pago, p_ubicacion, nullif(btrim(coalesce(p_direccion, '')), ''), nullif(btrim(coalesce(p_notas, '')), ''))
  returning * into nuevo;
  return jsonb_build_object('ok', true, 'numero', nuevo.numero, 'total', nuevo.total, 'repetido', false,
                            'envio_a_confirmar', (cot->>'envio_a_confirmar')::boolean);
end $$;
revoke all on function public.wa_registrar_pedido(text, text, text, jsonb, text, text, jsonb, text, text) from public, anon, authenticated;

-- Avanza el estado de un pedido. Solo hacia adelante (o rechazar un pedido nuevo o aceptado).
-- La llama el servidor después de comprobar que el pedido es del usuario; devuelve el pedido actualizado.
create or replace function public.wa_cambiar_estado(p_id uuid, p_negocio uuid, p_estado text, p_motivo text)
returns public.wa_pedidos language plpgsql volatile security definer set search_path = public as $$
declare
  p public.wa_pedidos;
  orden constant text[] := array['nuevo', 'aceptado', 'en_preparacion', 'en_camino', 'entregado'];
begin
  select * into p from public.wa_pedidos where id = p_id and negocio_id = p_negocio for update;
  if not found then raise exception 'No encontramos ese pedido.'; end if;
  if p.estado in ('entregado', 'rechazado') then raise exception 'Ese pedido ya está terminado.'; end if;
  if p_estado = 'rechazado' then
    if p.estado not in ('nuevo', 'aceptado') then raise exception 'Un pedido que ya se está preparando no se puede rechazar.'; end if;
  elsif coalesce(array_position(orden, p_estado), 0) <= array_position(orden, p.estado) then
    raise exception 'El pedido ya pasó por ese estado.';
  end if;
  update public.wa_pedidos set estado = p_estado, actualizado = now(),
    motivo_rechazo = case when p_estado = 'rechazado' then nullif(btrim(coalesce(p_motivo, '')), '') end
  where id = p_id returning * into p;
  return p;
end $$;
revoke all on function public.wa_cambiar_estado(uuid, uuid, text, text) from public, anon, authenticated;

-- Limpieza: los ids de mensajes procesados solo hacen falta unos días.
create or replace function public.wa_limpiar()
returns void language sql volatile security definer set search_path = public as $$
  delete from public.wa_mensajes where recibido < now() - interval '7 days';
$$;
revoke all on function public.wa_limpiar() from public, anon, authenticated;

-- En Supabase el servidor usa el rol service_role (salta RLS). En una base de prueba puede no existir.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.wa_charlas, public.wa_mensajes, public.wa_pedidos, public.wa_salida to service_role;
    grant usage on sequence public.wa_salida_id_seq to service_role;
    grant execute on function public.wa_registrar_pedido(text, text, text, jsonb, text, text, jsonb, text, text),
                              public.wa_cambiar_estado(uuid, uuid, text, text), public.wa_limpiar(), public.wa_contexto(text),
                              public.wa_encolar(uuid, text, text, text, text, jsonb), public.wa_tomar(uuid, text, text), public.wa_soltar(uuid, text),
                              public.menu_publico(text), public.cotizar_pedido(text, jsonb, text) to service_role;
  end if;
end $$;
