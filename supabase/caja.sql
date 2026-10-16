-- Venutto Caja: ventas y caja diaria.
-- Se corre DESPUÉS de schema.sql. Pegar entero en Supabase > SQL Editor > New query > Run.
-- Se puede correr más de una vez: no borra datos.
--
-- Reglas generales:
-- * El celular solo puede LEER estas tablas. Para escribir llama a las funciones de abajo
--   (abrir_caja, confirmar_venta), que validan todo y guardan en una sola transacción.
-- * La plata se guarda en numeric(12,2): pesos con centavos exactos, sin errores de redondeo.
-- * Los ids los genera el celular. Si un pedido llega dos veces (doble toque, reintento),
--   la base reconoce el id y no duplica nada.

-- ---------- Tablas ----------

create table if not exists public.cajas (
  id uuid primary key,
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  numero int not null,
  fecha_operacion date not null,                 -- fecha de apertura en hora de Argentina
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  abierta_en timestamptz not null default now(),
  abierta_por uuid not null default auth.uid(),
  saldo_inicial numeric(12,2) not null check (saldo_inicial >= 0),
  cerrada_en timestamptz,
  cerrada_por uuid,
  efectivo_esperado numeric(12,2),
  efectivo_contado numeric(12,2) check (efectivo_contado >= 0),
  diferencia_efectivo numeric(12,2),
  transferencias_banco numeric(12,2),
  diferencia_transferencias numeric(12,2),
  fondo_siguiente numeric(12,2) check (fondo_siguiente >= 0),
  observaciones text,
  resumen jsonb,                                 -- foto del informe al cerrar: no cambia aunque después se anule algo
  unique (negocio_id, numero)
);
-- Nunca dos cajas abiertas en el mismo negocio, aunque dos celulares toquen "Abrir" a la vez.
create unique index if not exists cajas_una_abierta on public.cajas (negocio_id) where estado = 'abierta';

create table if not exists public.ventas (
  id uuid primary key,
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  caja_id uuid not null references public.cajas (id),
  numero int not null,                           -- Venta 1, 2, 3… dentro de la caja
  creada_en timestamptz not null default now(),
  creada_por uuid not null default auth.uid(),
  estado text not null default 'confirmada' check (estado in ('confirmada', 'anulada')),
  bruto numeric(12,2) not null check (bruto >= 0),
  descuento numeric(12,2) not null default 0 check (descuento >= 0 and descuento <= bruto),
  motivo_descuento text,
  cargo_envio numeric(12,2) not null default 0 check (cargo_envio >= 0),
  con_envio boolean not null default false,
  total numeric(12,2) not null check (total >= 0),
  costo_mercaderia numeric(12,2) not null check (costo_mercaderia >= 0),
  costo_incompleto boolean not null default false,
  anulada_en timestamptz,
  anulada_por uuid,
  motivo_anulacion text,
  anulada_en_caja uuid references public.cajas (id),
  check (total = bruto - descuento + cargo_envio),
  check (descuento = 0 or coalesce(btrim(motivo_descuento), '') <> ''),
  unique (caja_id, numero)
);
create index if not exists ventas_caja on public.ventas (caja_id);

create table if not exists public.venta_items (
  venta_id uuid not null references public.ventas (id) on delete cascade,
  renglon int not null,
  producto_id text not null,                     -- puede borrarse del catálogo: la foto de abajo queda
  opcion_id text,
  nombre text not null,
  tipo text not null,
  categoria text,
  cantidad int not null check (cantidad > 0 and cantidad <= 999),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),  -- lo pone la base desde el catálogo
  envio_incluido_unitario numeric(12,2) not null default 0,
  costo_unitario numeric(12,2) not null check (costo_unitario >= 0),     -- insumos + packaging, sin gastos fijos
  packaging_unitario numeric(12,2) not null default 0 check (packaging_unitario >= 0),
  costo_incompleto boolean not null default false,
  faltas text[] not null default '{}',
  primary key (venta_id, renglon)
);

-- Fase 3: cuántos productos cuenta cada unidad vendida (una promo de 3 lomitos cuenta 3), para repartir gastos fijos.
alter table public.venta_items add column if not exists unidades int not null default 1 check (unidades between 1 and 999);

create table if not exists public.venta_pagos (
  venta_id uuid not null references public.ventas (id) on delete cascade,
  medio text not null,
  importe numeric(12,2) not null check (importe > 0),
  primary key (venta_id, medio)
);

-- Registro de eventos importantes (apertura, cierre, anulaciones). Solo se agregan filas.
create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  creado_en timestamptz not null default now(),
  usuario uuid default auth.uid(),
  accion text not null,
  detalle jsonb
);

-- ---------- Permisos: el celular solo lee ----------

alter table public.cajas enable row level security;
alter table public.ventas enable row level security;
alter table public.venta_items enable row level security;
alter table public.venta_pagos enable row level security;
alter table public.auditoria enable row level security;

revoke all on public.cajas, public.ventas, public.venta_items, public.venta_pagos, public.auditoria from anon, authenticated;
grant select on public.cajas, public.ventas, public.venta_items, public.venta_pagos, public.auditoria to authenticated;

drop policy if exists "cajas del negocio" on public.cajas;
create policy "cajas del negocio" on public.cajas for select using (public.puede_usar(negocio_id));
drop policy if exists "ventas del negocio" on public.ventas;
create policy "ventas del negocio" on public.ventas for select using (public.puede_usar(negocio_id));
drop policy if exists "renglones del negocio" on public.venta_items;
create policy "renglones del negocio" on public.venta_items for select
  using (exists (select 1 from public.ventas v where v.id = venta_id and public.puede_usar(v.negocio_id)));
drop policy if exists "pagos del negocio" on public.venta_pagos;
create policy "pagos del negocio" on public.venta_pagos for select
  using (exists (select 1 from public.ventas v where v.id = venta_id and public.puede_usar(v.negocio_id)));
drop policy if exists "auditoria del negocio" on public.auditoria;
create policy "auditoria del negocio" on public.auditoria for select using (public.puede_usar(negocio_id));

-- ---------- Funciones ----------

-- El negocio del usuario que llama, si puede usar la app. Si no, corta con un mensaje claro.
create or replace function public.caja_mi_negocio()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare neg uuid;
begin
  select n.id into neg from public.negocios n where n.owner_id = auth.uid();
  if neg is null or not public.puede_usar(neg) then
    raise exception 'Tu cuenta no tiene acceso a la caja. Revisá tu suscripción.';
  end if;
  return neg;
end $$;

-- Abre la caja del día. Si ya hay una abierta, devuelve esa en vez de abrir otra.
create or replace function public.abrir_caja(p_id uuid, p_saldo_inicial numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  neg uuid := public.caja_mi_negocio();
  c public.cajas;
begin
  if p_saldo_inicial is null or p_saldo_inicial < 0 then
    raise exception 'El efectivo inicial no puede ser negativo.';
  end if;
  -- Bloquea el negocio un instante para que dos aperturas simultáneas no compitan por el número.
  perform 1 from public.negocios where id = neg for update;
  select * into c from public.cajas where negocio_id = neg and estado = 'abierta';
  if found then return to_jsonb(c) || jsonb_build_object('ya_estaba', true); end if;
  select * into c from public.cajas where id = p_id;
  if found then
    if c.negocio_id <> neg then raise exception 'Id de caja inválido.'; end if;
    return to_jsonb(c) || jsonb_build_object('ya_estaba', true);
  end if;
  insert into public.cajas (id, negocio_id, numero, fecha_operacion, saldo_inicial)
  values (p_id, neg,
          coalesce((select max(numero) from public.cajas where negocio_id = neg), 0) + 1,
          (now() at time zone 'America/Argentina/Buenos_Aires')::date,
          round(p_saldo_inicial, 2))
  returning * into c;
  insert into public.auditoria (negocio_id, accion, detalle)
  values (neg, 'abrir_caja', jsonb_build_object('caja', c.id, 'numero', c.numero, 'saldo_inicial', c.saldo_inicial));
  return to_jsonb(c) || jsonb_build_object('ya_estaba', false);
end $$;

-- Confirma una venta completa: renglones, pagos y totales, todo junto o nada.
-- p_items: [{ "producto": "id", "opcion": "id o null", "cantidad": 2,
--             "costo_unitario": 5200.5, "packaging_unitario": 300, "costo_incompleto": false, "faltas": [] }]
--   El precio NO viene del celular: se lee del catálogo. El costo sí, porque lo calcula costos.js
--   (la misma cuenta que la calculadora) y repetirla acá sería duplicarla.
-- p_pagos: [{ "medio": "efectivo", "importe": 8000 }, { "medio": "transferencia", "importe": 20000 }]
create or replace function public.confirmar_venta(
  p_id uuid,
  p_items jsonb,
  p_pagos jsonb,
  p_descuento numeric default 0,
  p_motivo_descuento text default null,
  p_cargo_envio numeric default 0,
  p_con_envio boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  neg uuid := public.caja_mi_negocio();
  v public.ventas;
  caja public.cajas;
  it jsonb;
  pg jsonb;
  prod jsonb;
  op jsonb;
  medios jsonb;
  n int := 0;
  cant int;
  precio numeric(12,2);
  costo numeric(12,2);
  pack numeric(12,2);
  unid int;
  v_bruto numeric(12,2) := 0;
  costo_total numeric(12,2) := 0;
  incompleto boolean := false;
  v_descuento numeric(12,2) := round(coalesce(p_descuento, 0), 2);
  v_envio numeric(12,2) := round(coalesce(p_cargo_envio, 0), 2);
  v_total numeric(12,2);
  pagado numeric(12,2) := 0;
  inserted boolean;
begin
  -- 1. ¿Ya llegó esta misma venta? Devolverla tal cual, sin duplicar.
  select * into v from public.ventas where id = p_id;
  if found then
    if v.negocio_id <> neg then raise exception 'Id de venta inválido.'; end if;
    return jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total, 'duplicada', true);
  end if;

  -- 2. Tiene que haber una caja abierta. La fila queda bloqueada hasta el final: numera sin choques.
  select * into caja from public.cajas where negocio_id = neg and estado = 'abierta' for update;
  if not found then raise exception 'No hay una caja abierta. Abrí la caja para vender.'; end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos.';
  end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'Demasiados renglones en una venta.'; end if;
  if v_envio < 0 then raise exception 'El envío no puede ser negativo.'; end if;

  -- 3. Cabecera con totales en 0 (se completan en el paso 6). Reserva el número de venta.
  insert into public.ventas (id, negocio_id, caja_id, numero, bruto, descuento, motivo_descuento, cargo_envio, con_envio, total, costo_mercaderia)
  values (p_id, neg, caja.id,
          coalesce((select max(numero) from public.ventas where caja_id = caja.id), 0) + 1,
          0, 0, null, 0, coalesce(p_con_envio, false), 0, 0)
  on conflict (id) do nothing
  returning * into v;
  inserted := found;
  if not inserted then
    -- Otro pedido con el mismo id ganó la carrera mientras esperábamos la caja.
    select * into v from public.ventas where id = p_id;
    return jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total, 'duplicada', true);
  end if;

  -- 4. Renglones: precio y nombre salen del catálogo.
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    select datos into prod from public.productos where negocio_id = neg and id = it->>'producto';
    if prod is null then raise exception 'Un producto de la venta ya no existe en el catálogo. Recargá la página.'; end if;
    if coalesce((prod->>'esPreparacion')::boolean, false) then raise exception '% es una preparación propia: no se vende.', prod->>'nombre'; end if;
    if coalesce((prod->>'enCaja')::boolean, true) = false then raise exception '% no está a la venta en la caja.', prod->>'nombre'; end if;
    begin
      cant := (it->>'cantidad')::int;
    exception when others then cant := null;
    end;
    if cant is null or cant <= 0 or cant > 999 then raise exception 'Cantidad inválida para %.', prod->>'nombre'; end if;
    precio := round(nullif(prod->>'precioVenta', '')::numeric, 2);
    if precio is null or precio <= 0 then raise exception '% no tiene precio de venta. Cargalo en Productos.', prod->>'nombre'; end if;

    op := null;
    if coalesce(it->>'opcion', '') <> '' then
      select o.value into op from jsonb_array_elements(coalesce(prod->'opciones', '[]'::jsonb)) as o(value) where o.value->>'id' = it->>'opcion';
      if op is null then raise exception 'La opción elegida para % ya no existe. Recargá la página.', prod->>'nombre'; end if;
      precio := precio + round(coalesce(nullif(op->>'precioExtra', '')::numeric, 0), 2);
    end if;

    costo := round(coalesce((it->>'costo_unitario')::numeric, 0), 2);
    pack := round(coalesce((it->>'packaging_unitario')::numeric, 0), 2);
    if costo < 0 or pack < 0 or pack > costo then raise exception 'Costo inválido para %.', prod->>'nombre'; end if;
    unid := coalesce(round((it->>'unidades')::numeric)::int, 1);
    if unid < 1 or unid > 999 then unid := 1; end if;

    insert into public.venta_items (venta_id, renglon, producto_id, opcion_id, nombre, tipo, categoria, cantidad,
      precio_unitario, envio_incluido_unitario, costo_unitario, packaging_unitario, costo_incompleto, faltas, unidades)
    values (p_id, n, it->>'producto', nullif(it->>'opcion', ''),
      coalesce(prod->>'nombre', '(sin nombre)') || coalesce(' (' || (op->>'nombre') || ')', ''),
      coalesce(nullif(prod->>'tipo', ''), 'producto'), nullif(prod->>'categoria', ''), cant, precio,
      round(greatest(coalesce(nullif(prod->>'envioIncluido', '')::numeric, 0), 0), 2), costo, pack,
      coalesce((it->>'costo_incompleto')::boolean, false),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(it->'faltas', '[]'::jsonb)) x), '{}'), unid);

    v_bruto := v_bruto + precio * cant;
    costo_total := costo_total + costo * cant;
    incompleto := incompleto or coalesce((it->>'costo_incompleto')::boolean, false);
  end loop;

  -- 5. Descuento y total.
  if v_descuento < 0 or v_descuento > v_bruto then raise exception 'El descuento no puede ser mayor que la venta.'; end if;
  if v_descuento > 0 and coalesce(btrim(p_motivo_descuento), '') = '' then raise exception 'Escribí el motivo del descuento.'; end if;
  v_total := v_bruto - v_descuento + v_envio;

  -- 6. Pagos: medios configurados y que sumen exactamente el total.
  select coalesce(datos->'medios', '["efectivo","transferencia"]'::jsonb) into medios from public.ajustes where negocio_id = neg and id = 'caja';
  medios := coalesce(medios, '["efectivo","transferencia"]'::jsonb);
  if jsonb_typeof(p_pagos) is distinct from 'array' then raise exception 'Falta el medio de pago.'; end if;
  for pg in select * from jsonb_array_elements(p_pagos) loop
    if not medios ? (pg->>'medio') then raise exception 'Medio de pago no habilitado: %.', pg->>'medio'; end if;
    if coalesce((pg->>'importe')::numeric, 0) <= 0 then raise exception 'Cada pago tiene que ser mayor a $ 0.'; end if;
    insert into public.venta_pagos (venta_id, medio, importe) values (p_id, pg->>'medio', round((pg->>'importe')::numeric, 2));
    pagado := pagado + round((pg->>'importe')::numeric, 2);
  end loop;
  if pagado <> v_total then
    raise exception 'Los pagos suman $ % y la venta es de $ %.', pagado, v_total;
  end if;

  update public.ventas set bruto = v_bruto, descuento = v_descuento,
    motivo_descuento = nullif(btrim(p_motivo_descuento), ''), cargo_envio = v_envio, total = v_total,
    costo_mercaderia = costo_total, costo_incompleto = incompleto
  where id = p_id
  returning * into v;
  return jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total, 'duplicada', false);
end $$;

-- Resumen de una caja: ventas, costo de mercadería, margen y resultado estimado.
-- Lo usa la pantalla para mostrar cómo va la noche, y lo va a usar el cierre para guardar la foto del informe.
-- Fórmulas (ver venutto-caja/fase-1-diseno.md, sección 7):
--   ventas netas = ventas brutas − descuentos (el cargo de envío va aparte)
--   margen bruto = ventas netas − costo de mercadería vendida (insumos + packaging, foto de cada venta)
--   resultado estimado = margen bruto + envíos cobrados − gastos fijos estimados − nafta estimada
create or replace function public.resumen_caja(p_caja_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  neg uuid := public.caja_mi_negocio();
  c public.cajas;
  r jsonb;
  total_fijos numeric;
  unidades_mes numeric;
  fijo_u numeric(12,2) := 0;
  nafta_p numeric(12,2) := 0;
  d jsonb;
begin
  select * into c from public.cajas where id = p_caja_id and negocio_id = neg;
  if not found then raise exception 'No se encontró la caja.'; end if;

  -- Gastos fijos por producto y nafta por pedido, con los valores cargados hoy en la calculadora.
  select sum(coalesce(nullif(datos->>'monto', '')::numeric, 0)) into total_fijos from public.gastos where negocio_id = neg;
  select nullif(datos->>'unidadesMes', '')::numeric into unidades_mes from public.ajustes where negocio_id = neg and id = 'general';
  if coalesce(unidades_mes, 0) > 0 then fijo_u := round(coalesce(total_fijos, 0) / unidades_mes, 2); end if;
  select datos into d from public.ajustes where negocio_id = neg and id = 'delivery';
  if coalesce(nullif(d->>'pedidosMes', '')::numeric, 0) > 0 then
    nafta_p := round(coalesce(nullif(d->>'naftaMes', '')::numeric, 0) / (d->>'pedidosMes')::numeric, 2);
  end if;

  with v as (select * from public.ventas where caja_id = c.id and estado = 'confirmada'),
       it as (select i.* from public.venta_items i join v on v.id = i.venta_id),
       base as (
         select (select count(*) from v) as ventas,
                coalesce((select sum(bruto) from v), 0) as bruto,
                coalesce((select sum(descuento) from v), 0) as descuentos,
                coalesce((select sum(cargo_envio) from v), 0) as envios,
                coalesce((select sum(total) from v), 0) as cobrado,
                (select count(*) from v where con_envio) as pedidos_envio,
                (select count(*) from v where costo_incompleto) as incompletas,
                coalesce((select sum(costo_unitario * cantidad) from it), 0) as cmv,
                coalesce((select sum(packaging_unitario * cantidad) from it), 0) as packaging,
                coalesce((select sum(envio_incluido_unitario * cantidad) from it), 0) as envio_incluido,
                coalesce((select sum(unidades * cantidad) from it), 0) as unidades)
  select jsonb_build_object(
    'caja', c.id, 'numero', c.numero, 'fecha_operacion', c.fecha_operacion, 'estado', c.estado,
    'ventas', b.ventas,
    'ventas_brutas', b.bruto,
    'descuentos', b.descuentos,
    'ventas_netas', b.bruto - b.descuentos,
    'envios_cobrados', b.envios,
    'total_cobrado', b.cobrado,
    'costo_mercaderia', b.cmv,
    'packaging', b.packaging,
    'margen_bruto', b.bruto - b.descuentos - b.cmv,
    'margen_pct', case when b.bruto - b.descuentos > 0 then round((b.bruto - b.descuentos - b.cmv) * 100 / (b.bruto - b.descuentos), 1) end,
    'envio_incluido_en_precios', b.envio_incluido,
    'unidades', b.unidades,
    'gasto_fijo_por_unidad', fijo_u,
    'gastos_fijos_estimados', fijo_u * b.unidades,
    'pedidos_con_envio', b.pedidos_envio,
    'nafta_por_pedido', nafta_p,
    'nafta_estimada', nafta_p * b.pedidos_envio,
    'resultado_estimado', b.bruto - b.descuentos - b.cmv + b.envios - fijo_u * b.unidades - nafta_p * b.pedidos_envio,
    'ventas_costo_incompleto', b.incompletas,
    'productos_costo_incompleto', coalesce((select jsonb_agg(distinct nombre) from it where costo_incompleto), '[]'::jsonb),
    'por_producto', coalesce((
      select jsonb_agg(x order by (x->>'ventas')::numeric desc) from (
        select jsonb_build_object('nombre', nombre, 'cantidad', sum(cantidad), 'ventas', sum(precio_unitario * cantidad),
                 'costo', sum(costo_unitario * cantidad), 'margen', sum((precio_unitario - costo_unitario) * cantidad),
                 'costo_incompleto', bool_or(costo_incompleto)) as x
        from it group by nombre) t), '[]'::jsonb),
    'por_medio', coalesce((
      select jsonb_object_agg(medio, total) from (
        select p.medio, sum(p.importe) as total from public.venta_pagos p join v on v.id = p.venta_id group by p.medio) t), '{}'::jsonb),
    'anuladas', (select count(*) from public.ventas where caja_id = c.id and estado = 'anulada')
  ) into r
  from base b;
  return r;
end $$;

revoke all on function public.resumen_caja(uuid) from public, anon;
grant execute on function public.resumen_caja(uuid) to authenticated;

revoke all on function public.caja_mi_negocio() from public, anon;
revoke all on function public.abrir_caja(uuid, numeric) from public, anon;
revoke all on function public.confirmar_venta(uuid, jsonb, jsonb, numeric, text, numeric, boolean) from public, anon;
grant execute on function public.caja_mi_negocio() to authenticated;
grant execute on function public.abrir_caja(uuid, numeric) to authenticated;
grant execute on function public.confirmar_venta(uuid, jsonb, jsonb, numeric, text, numeric, boolean) to authenticated;
