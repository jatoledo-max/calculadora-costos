-- Venutto Caja: ventas y caja diaria.
-- Se corre DESPUÉS de schema.sql. Pegar entero en Supabase > SQL Editor > New query > Run.
-- Se puede correr más de una vez: no borra datos.
--
-- Reglas generales:
-- * El celular solo puede LEER estas tablas. Para escribir llama a las funciones de abajo
--   (abrir_caja, confirmar_venta, registrar_movimiento, anular_venta, cerrar_caja…), que validan todo
--   y guardan en una sola transacción.
-- * Nada se borra: las ventas y los movimientos se anulan con motivo, y una caja cerrada no cambia más.
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
-- Fase 6: los informes buscan las cajas por fecha.
create index if not exists cajas_fecha on public.cajas (negocio_id, fecha_operacion);

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

-- Fase 4: todo lo que entra o sale de la caja sin ser una venta.
--   gasto              pagaste algo del negocio (gas, cadete). Resta del resultado, salvo que ya esté en los gastos fijos.
--   compra_mercaderia  compraste insumos. Resta plata pero NO del resultado: ese costo entra cuando se vende (costo de mercadería).
--   aporte / retiro    pusiste o sacaste plata de la caja. No cambian el resultado.
--   reserva            apartaste plata (para reponer mercadería, por ejemplo). Sigue en la caja; baja el "disponible para retirar".
--   ajuste             corrección con motivo: positivo si sobra plata, negativo si falta.
create table if not exists public.movimientos (
  id uuid primary key,
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  caja_id uuid not null references public.cajas (id),
  tipo text not null check (tipo in ('gasto', 'compra_mercaderia', 'aporte', 'retiro', 'reserva', 'ajuste')),
  medio text not null,
  importe numeric(12,2) not null check (importe <> 0 and (tipo = 'ajuste' or importe > 0)),
  descripcion text,
  en_gastos_fijos boolean not null default false check (en_gastos_fijos = false or tipo = 'gasto'),
  creado_en timestamptz not null default now(),
  creado_por uuid not null default auth.uid(),
  estado text not null default 'vigente' check (estado in ('vigente', 'anulado')),
  anulado_en timestamptz,
  anulado_por uuid,
  motivo_anulacion text,
  check (tipo not in ('gasto', 'compra_mercaderia', 'ajuste') or coalesce(btrim(descripcion), '') <> ''),
  check (estado = 'vigente' or coalesce(btrim(motivo_anulacion), '') <> '')
);
create index if not exists movimientos_caja on public.movimientos (caja_id);

-- Una anulación también necesita motivo (la columna existe desde la Fase 2).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ventas_anulada_con_motivo') then
    alter table public.ventas add constraint ventas_anulada_con_motivo
      check (estado = 'confirmada' or coalesce(btrim(motivo_anulacion), '') <> '');
  end if;
end $$;

-- ---------- Permisos: el celular solo lee ----------

alter table public.cajas enable row level security;
alter table public.ventas enable row level security;
alter table public.venta_items enable row level security;
alter table public.venta_pagos enable row level security;
alter table public.auditoria enable row level security;
alter table public.movimientos enable row level security;

revoke all on public.cajas, public.ventas, public.venta_items, public.venta_pagos, public.auditoria, public.movimientos from anon, authenticated;
grant select on public.cajas, public.ventas, public.venta_items, public.venta_pagos, public.auditoria, public.movimientos to authenticated;

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
drop policy if exists "movimientos del negocio" on public.movimientos;
create policy "movimientos del negocio" on public.movimientos for select using (public.puede_usar(negocio_id));

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
    raise exception 'Los pagos suman % y la venta es de %.', public.caja_pesos(pagado), public.caja_pesos(v_total);
  end if;

  update public.ventas set bruto = v_bruto, descuento = v_descuento,
    motivo_descuento = nullif(btrim(p_motivo_descuento), ''), cargo_envio = v_envio, total = v_total,
    costo_mercaderia = costo_total, costo_incompleto = incompleto
  where id = p_id
  returning * into v;
  return jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total, 'duplicada', false);
end $$;

-- Pesos para los mensajes de error: 10500 → "$ 10.500", 10500.5 → "$ 10.500,50".
create or replace function public.caja_pesos(n numeric)
returns text language sql immutable set search_path = public as $$
  select case when n < 0 then '− ' else '' end || '$ ' ||
    regexp_replace(translate(to_char(abs(n), 'FM999,999,999,990.00'), ',.', '.,'), ',00$', '')
$$;

-- Informe de una caja, calculado en el momento con lo que está guardado.
-- Uso interno: lo llaman resumen_caja (pantalla en vivo) y cerrar_caja (foto del cierre). El celular no lo llama directo.
-- Fórmulas (ver venutto-caja/fase-1-diseno.md, sección 7):
--   ventas netas       = ventas brutas − descuentos (el cargo de envío va aparte)
--   margen bruto       = ventas netas − costo de mercadería vendida (insumos + packaging, foto de cada venta)
--   resultado estimado = margen bruto + envíos cobrados − gastos del día − gastos fijos estimados − nafta estimada
--   efectivo esperado  = saldo inicial + cobros en efectivo + aportes − gastos − compras − retiros ± ajustes (todo en efectivo)
-- Las ventas anuladas no cuentan en nada (si la anulaste en la misma caja, la plata se devolvió).
create or replace function public.caja_informe(c public.cajas)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  neg uuid := c.negocio_id;
  r jsonb;
  total_fijos numeric;
  unidades_mes numeric;
  fijo_u numeric(12,2) := 0;
  nafta_p numeric(12,2) := 0;
  d jsonb;
  oblig jsonb;
begin
  -- Gastos fijos por producto y nafta por pedido, con los valores cargados hoy en la calculadora.
  select sum(coalesce(nullif(datos->>'monto', '')::numeric, 0)) into total_fijos from public.gastos where negocio_id = neg;
  select nullif(datos->>'unidadesMes', '')::numeric into unidades_mes from public.ajustes where negocio_id = neg and id = 'general';
  if coalesce(unidades_mes, 0) > 0 then fijo_u := round(coalesce(total_fijos, 0) / unidades_mes, 2); end if;
  select datos into d from public.ajustes where negocio_id = neg and id = 'delivery';
  if coalesce(nullif(d->>'pedidosMes', '')::numeric, 0) > 0 then
    nafta_p := round(coalesce(nullif(d->>'naftaMes', '')::numeric, 0) / (d->>'pedidosMes')::numeric, 2);
  end if;
  -- Pagos pendientes (alquiler, proveedor…) cargados en Informes: no son plata para retirar.
  -- Se toman solo los que tienen un monto válido mayor a 0.
  select coalesce(jsonb_agg(jsonb_build_object('nombre', left(coalesce(x->>'nombre', ''), 80), 'monto', round((x->>'monto')::numeric, 2),
           'vence', case when x->>'vence' ~ '^\d{4}-\d{2}-\d{2}$' then x->>'vence' end)), '[]'::jsonb)
    into oblig
  from public.ajustes a, jsonb_array_elements(case when jsonb_typeof(a.datos->'items') = 'array' then a.datos->'items' else '[]'::jsonb end) x
  where a.negocio_id = neg and a.id = 'obligaciones'
    and (case when x->>'monto' ~ '^\d{1,10}(\.\d+)?$' then (x->>'monto')::numeric end) > 0;

  with v as (select * from public.ventas where caja_id = c.id and estado = 'confirmada'),
       it as (select i.* from public.venta_items i join v on v.id = i.venta_id),
       pg as (select p.* from public.venta_pagos p join v on v.id = p.venta_id),
       mv as (select * from public.movimientos where caja_id = c.id and estado = 'vigente'),
       -- Cómo mueve la plata de cada medio cada movimiento: aportes suman, gastos/compras/retiros restan,
       -- ajustes con su signo, reservas no mueven nada (la plata sigue en la caja).
       flujo as (select medio, sum(case tipo when 'aporte' then importe when 'ajuste' then importe when 'reserva' then 0 else -importe end) as neto
                 from mv group by medio),
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
                coalesce((select sum(unidades * cantidad) from it), 0) as unidades,
                coalesce((select sum(importe) from pg where medio = 'efectivo'), 0) as cobrado_ef,
                coalesce((select sum(importe) from pg where medio = 'transferencia'), 0) as cobrado_tr,
                coalesce((select sum(importe) from mv where tipo = 'gasto' and not en_gastos_fijos), 0) as gastos_op,
                coalesce((select sum(importe) from mv where tipo = 'gasto' and en_gastos_fijos), 0) as gastos_en_fijos,
                coalesce((select sum(importe) from mv where tipo = 'compra_mercaderia'), 0) as compras,
                coalesce((select sum(importe) from mv where tipo = 'aporte'), 0) as aportes,
                coalesce((select sum(importe) from mv where tipo = 'retiro'), 0) as retiros,
                coalesce((select sum(importe) from mv where tipo = 'reserva'), 0) as reservas,
                coalesce((select sum(importe) from mv where tipo = 'ajuste'), 0) as ajustes,
                coalesce((select neto from flujo where medio = 'efectivo'), 0) as flujo_ef,
                coalesce((select neto from flujo where medio = 'transferencia'), 0) as flujo_tr)
  select jsonb_build_object(
    'caja', c.id, 'numero', c.numero, 'fecha_operacion', c.fecha_operacion, 'estado', c.estado,
    'abierta_en', c.abierta_en, 'saldo_inicial', c.saldo_inicial,
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
    'gastos_operativos', b.gastos_op,
    'gastos_en_fijos', b.gastos_en_fijos,
    'resultado_estimado', b.bruto - b.descuentos - b.cmv + b.envios - b.gastos_op - fijo_u * b.unidades - nafta_p * b.pedidos_envio,
    'compras_mercaderia', b.compras,
    'aportes', b.aportes,
    'retiros', b.retiros,
    'ajustes', b.ajustes,
    'cobrado_efectivo', b.cobrado_ef,
    'movimientos_efectivo', b.flujo_ef,
    'efectivo_esperado', c.saldo_inicial + b.cobrado_ef + b.flujo_ef,
    'cobrado_transferencia', b.cobrado_tr,
    'movimientos_transferencia', b.flujo_tr,
    'transferencias_esperadas', b.cobrado_tr + b.flujo_tr,
    'reserva_sugerida', b.cmv,
    'reserva_apartada', b.reservas,
    'ventas_costo_incompleto', b.incompletas,
    'productos_costo_incompleto', coalesce((select jsonb_agg(distinct nombre) from it where costo_incompleto), '[]'::jsonb),
    'por_producto', coalesce((
      select jsonb_agg(x order by (x->>'ventas')::numeric desc) from (
        select jsonb_build_object('nombre', nombre, 'cantidad', sum(cantidad), 'ventas', sum(precio_unitario * cantidad),
                 'costo', sum(costo_unitario * cantidad), 'margen', sum((precio_unitario - costo_unitario) * cantidad),
                 'costo_incompleto', bool_or(costo_incompleto)) as x
        from it group by nombre) t), '[]'::jsonb),
    'por_medio', coalesce((select jsonb_object_agg(medio, total) from (select medio, sum(importe) as total from pg group by medio) t), '{}'::jsonb),
    'anuladas', (select count(*) from public.ventas where caja_id = c.id and estado = 'anulada'),
    'anuladas_total', coalesce((select sum(total) from public.ventas where caja_id = c.id and estado = 'anulada'), 0),
    -- Ventas de cajas ya cerradas que se anularon en esta: el cierre de su día no cambia; se informan acá.
    'anulaciones_anteriores', coalesce((
      select jsonb_agg(jsonb_build_object('caja', ca.numero, 'venta', x.numero, 'total', x.total, 'motivo', x.motivo_anulacion) order by x.anulada_en)
      from public.ventas x join public.cajas ca on ca.id = x.caja_id
      where x.anulada_en_caja = c.id and x.caja_id <> c.id), '[]'::jsonb),
    'anulaciones_anteriores_total', coalesce((select sum(total) from public.ventas where anulada_en_caja = c.id and caja_id <> c.id), 0),
    'obligaciones', oblig,
    'obligaciones_pendientes', coalesce((select sum((o->>'monto')::numeric) from jsonb_array_elements(oblig) o), 0)
  ) into r
  from base b;
  return r;
end $$;

-- Resumen para la pantalla. Si la caja está abierta, se calcula en el momento.
-- Si está cerrada, devuelve la foto guardada al cerrar: lo que pase después (una anulación, un cambio de gastos fijos) no la cambia.
create or replace function public.resumen_caja(p_caja_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  neg uuid := public.caja_mi_negocio();
  c public.cajas;
begin
  select * into c from public.cajas where id = p_caja_id and negocio_id = neg;
  if not found then raise exception 'No se encontró la caja.'; end if;
  if c.estado = 'cerrada' and c.resumen is not null then return c.resumen; end if;
  return public.caja_informe(c);
end $$;

-- Gasto, compra de mercadería, aporte, retiro, reserva o ajuste en la caja abierta.
-- Mismo criterio que las ventas: el id lo genera el celular y si llega dos veces no se duplica.
create or replace function public.registrar_movimiento(
  p_id uuid,
  p_tipo text,
  p_medio text,
  p_importe numeric,
  p_descripcion text default null,
  p_en_gastos_fijos boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  neg uuid := public.caja_mi_negocio();
  caja public.cajas;
  m public.movimientos;
  medios jsonb;
  v_importe numeric(12,2) := round(p_importe, 2);
  v_desc text := nullif(btrim(coalesce(p_descripcion, '')), '');
  esperado numeric(12,2);
begin
  select * into m from public.movimientos where id = p_id;
  if found then
    if m.negocio_id <> neg then raise exception 'Id de movimiento inválido.'; end if;
    return to_jsonb(m) || jsonb_build_object('duplicado', true);
  end if;

  select * into caja from public.cajas where negocio_id = neg and estado = 'abierta' for update;
  if not found then raise exception 'No hay una caja abierta.'; end if;

  if p_tipo is null or p_tipo not in ('gasto', 'compra_mercaderia', 'aporte', 'retiro', 'reserva', 'ajuste') then
    raise exception 'Tipo de movimiento inválido.';
  end if;
  select coalesce(datos->'medios', '["efectivo","transferencia"]'::jsonb) into medios from public.ajustes where negocio_id = neg and id = 'caja';
  medios := coalesce(medios, '["efectivo","transferencia"]'::jsonb);
  if p_medio is null or not medios ? p_medio then raise exception 'Medio de pago no habilitado: %.', p_medio; end if;
  if v_importe is null or v_importe = 0 or (p_tipo <> 'ajuste' and v_importe < 0) then
    raise exception 'El importe tiene que ser mayor a $ 0.';
  end if;
  if v_desc is null and p_tipo in ('gasto', 'compra_mercaderia') then raise exception 'Escribí qué pagaste.'; end if;
  if v_desc is null and p_tipo = 'ajuste' then raise exception 'Escribí el motivo del ajuste.'; end if;

  -- No puede salir más efectivo del que hay en la caja.
  if p_medio = 'efectivo' and (p_tipo in ('gasto', 'compra_mercaderia', 'retiro') or (p_tipo = 'ajuste' and v_importe < 0)) then
    esperado := (public.caja_informe(caja)->>'efectivo_esperado')::numeric;
    if abs(v_importe) > esperado then
      raise exception 'En la caja debería haber % en efectivo: no alcanza para sacar %. Si contaste más plata, cargá primero un ajuste o un aporte.',
        public.caja_pesos(esperado), public.caja_pesos(abs(v_importe));
    end if;
  end if;

  insert into public.movimientos (id, negocio_id, caja_id, tipo, medio, importe, descripcion, en_gastos_fijos)
  values (p_id, neg, caja.id, p_tipo, p_medio, v_importe, v_desc, p_tipo = 'gasto' and coalesce(p_en_gastos_fijos, false))
  on conflict (id) do nothing
  returning * into m;
  if not found then
    select * into m from public.movimientos where id = p_id;
    return to_jsonb(m) || jsonb_build_object('duplicado', true);
  end if;
  insert into public.auditoria (negocio_id, accion, detalle)
  values (neg, 'movimiento', jsonb_build_object('caja', caja.id, 'movimiento', m.id, 'tipo', m.tipo, 'medio', m.medio, 'importe', m.importe));
  return to_jsonb(m) || jsonb_build_object('duplicado', false);
end $$;

-- Anula un movimiento cargado por error. Solo mientras su caja siga abierta: una caja cerrada no se toca.
create or replace function public.anular_movimiento(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  neg uuid := public.caja_mi_negocio();
  m public.movimientos;
  caja public.cajas;
begin
  select * into m from public.movimientos where id = p_id and negocio_id = neg;
  if not found then raise exception 'No se encontró el movimiento.'; end if;
  select * into caja from public.cajas where id = m.caja_id for update;
  select * into m from public.movimientos where id = p_id for update;
  if m.estado = 'anulado' then return to_jsonb(m) || jsonb_build_object('ya_estaba', true); end if;
  if caja.estado <> 'abierta' then raise exception 'La caja de ese movimiento ya está cerrada: no se puede cambiar.'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación.'; end if;
  update public.movimientos set estado = 'anulado', anulado_en = now(), anulado_por = auth.uid(), motivo_anulacion = btrim(p_motivo)
  where id = p_id returning * into m;
  insert into public.auditoria (negocio_id, accion, detalle)
  values (neg, 'anular_movimiento', jsonb_build_object('caja', caja.id, 'movimiento', m.id, 'tipo', m.tipo, 'importe', m.importe, 'motivo', m.motivo_anulacion));
  return to_jsonb(m) || jsonb_build_object('ya_estaba', false);
end $$;

-- Anula una venta. No se borra ni se edita: queda marcada, con quién, cuándo, por qué y en qué caja se anuló.
-- Si la venta es de la caja abierta, deja de contar en ventas y en efectivo esperado (se devolvió la plata).
-- Si es de una caja ya cerrada, ese cierre NO cambia: la anulación aparece en el informe de la caja abierta
-- como "anulación de días anteriores", y si devolviste plata la cargás como retiro.
create or replace function public.anular_venta(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  neg uuid := public.caja_mi_negocio();
  v public.ventas;
  caja public.cajas;
begin
  select * into v from public.ventas where id = p_id and negocio_id = neg;
  if not found then raise exception 'No se encontró la venta.'; end if;
  if v.estado = 'anulada' then
    return jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total, 'ya_estaba', true, 'misma_caja', v.caja_id = v.anulada_en_caja);
  end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación.'; end if;
  select * into caja from public.cajas where negocio_id = neg and estado = 'abierta' for update;
  if not found then raise exception 'Abrí la caja para anular: la anulación queda registrada en la caja abierta.'; end if;
  select * into v from public.ventas where id = p_id for update;
  if v.estado = 'anulada' then
    return jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total, 'ya_estaba', true, 'misma_caja', v.caja_id = v.anulada_en_caja);
  end if;
  update public.ventas set estado = 'anulada', anulada_en = now(), anulada_por = auth.uid(),
    motivo_anulacion = btrim(p_motivo), anulada_en_caja = caja.id
  where id = p_id returning * into v;
  insert into public.auditoria (negocio_id, accion, detalle)
  values (neg, 'anular_venta', jsonb_build_object('venta', v.id, 'caja_venta', v.caja_id, 'caja_anulacion', caja.id,
    'numero', v.numero, 'total', v.total, 'motivo', v.motivo_anulacion));
  return jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total, 'ya_estaba', false, 'misma_caja', v.caja_id = caja.id);
end $$;

-- Cierra la caja: compara el efectivo contado con el esperado, guarda la foto del informe y deja la caja cerrada.
-- Es una sola operación: si algo falla, la caja sigue abierta y no queda nada a medias.
-- Si la caja ya estaba cerrada (por ejemplo, el celular no recibió la respuesta y reintenta), devuelve el informe guardado.
create or replace function public.cerrar_caja(
  p_caja_id uuid,
  p_efectivo_contado numeric,
  p_transferencias_banco numeric default null,
  p_fondo_siguiente numeric default 0,
  p_observaciones text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  neg uuid := public.caja_mi_negocio();
  c public.cajas;
  r jsonb;
  contado numeric(12,2) := round(p_efectivo_contado, 2);
  banco numeric(12,2) := round(p_transferencias_banco, 2);
  fondo numeric(12,2) := round(coalesce(p_fondo_siguiente, 0), 2);
  obs text := nullif(btrim(coalesce(p_observaciones, '')), '');
  esperado numeric(12,2);
  transf numeric(12,2);
  dif numeric(12,2);
  dif_tr numeric(12,2);
begin
  -- Bloquea la caja: mientras se cierra, ninguna venta ni movimiento puede entrar.
  select * into c from public.cajas where id = p_caja_id and negocio_id = neg for update;
  if not found then raise exception 'No se encontró la caja.'; end if;
  if c.estado = 'cerrada' then return c.resumen || jsonb_build_object('ya_estaba', true); end if;

  if contado is null or contado < 0 then raise exception 'Poné el efectivo que contaste (puede ser 0).'; end if;
  if banco is not null and banco < 0 then raise exception 'Lo que ves en el banco no puede ser negativo.'; end if;
  if fondo < 0 then raise exception 'El fondo para mañana no puede ser negativo.'; end if;
  if fondo > contado then raise exception 'El fondo para mañana no puede ser más que el efectivo contado.'; end if;

  r := public.caja_informe(c);
  esperado := (r->>'efectivo_esperado')::numeric;
  transf := (r->>'transferencias_esperadas')::numeric;
  dif := contado - esperado;
  dif_tr := banco - transf;   -- null si no se cargó lo del banco
  if (dif <> 0 or coalesce(dif_tr, 0) <> 0) and obs is null then
    raise exception 'Hay una diferencia de % en efectivo%. Escribí una observación antes de cerrar.',
      public.caja_pesos(dif), case when coalesce(dif_tr, 0) <> 0 then ' y de ' || public.caja_pesos(dif_tr) || ' en transferencias' else '' end;
  end if;

  r := r || jsonb_build_object(
    'estado', 'cerrada',
    'cerrada_en', now(),
    'efectivo_contado', contado,
    'diferencia_efectivo', dif,
    'transferencias_banco', banco,
    'diferencia_transferencias', dif_tr,
    'fondo_siguiente', fondo,
    'observaciones', obs,
    -- Disponible = lo que hay (efectivo contado + transferencias del día) − lo que queda de fondo − lo que apartaste
    -- − los pagos pendientes (la lista de pagos pendientes queda en la foto del cierre).
    'disponible_estimado', contado + coalesce(banco, transf) - fondo - (r->>'reserva_apartada')::numeric - (r->>'obligaciones_pendientes')::numeric);

  update public.cajas set estado = 'cerrada', cerrada_en = now(), cerrada_por = auth.uid(),
    efectivo_esperado = esperado, efectivo_contado = contado, diferencia_efectivo = dif,
    transferencias_banco = banco, diferencia_transferencias = dif_tr, fondo_siguiente = fondo,
    observaciones = obs, resumen = r
  where id = c.id;
  insert into public.auditoria (negocio_id, accion, detalle)
  values (neg, 'cerrar_caja', jsonb_build_object('caja', c.id, 'numero', c.numero, 'efectivo_esperado', esperado,
    'efectivo_contado', contado, 'diferencia', dif, 'fondo_siguiente', fondo));
  return r || jsonb_build_object('ya_estaba', false);
end $$;

-- ---------- Quién puede llamar a cada función ----------
revoke all on function public.caja_pesos(numeric) from public, anon;
revoke all on function public.caja_informe(public.cajas) from public, anon, authenticated;
revoke all on function public.caja_mi_negocio() from public, anon;
revoke all on function public.abrir_caja(uuid, numeric) from public, anon;
revoke all on function public.confirmar_venta(uuid, jsonb, jsonb, numeric, text, numeric, boolean) from public, anon;
revoke all on function public.resumen_caja(uuid) from public, anon;
revoke all on function public.registrar_movimiento(uuid, text, text, numeric, text, boolean) from public, anon;
revoke all on function public.anular_movimiento(uuid, text) from public, anon;
revoke all on function public.anular_venta(uuid, text) from public, anon;
revoke all on function public.cerrar_caja(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.caja_pesos(numeric) to authenticated;
grant execute on function public.caja_mi_negocio() to authenticated;
grant execute on function public.abrir_caja(uuid, numeric) to authenticated;
grant execute on function public.confirmar_venta(uuid, jsonb, jsonb, numeric, text, numeric, boolean) to authenticated;
grant execute on function public.resumen_caja(uuid) to authenticated;
grant execute on function public.registrar_movimiento(uuid, text, text, numeric, text, boolean) to authenticated;
grant execute on function public.anular_movimiento(uuid, text) to authenticated;
grant execute on function public.anular_venta(uuid, text) to authenticated;
grant execute on function public.cerrar_caja(uuid, numeric, numeric, numeric, text) to authenticated;
