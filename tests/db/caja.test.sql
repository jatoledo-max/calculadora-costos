-- Pruebas de caja.sql. Cada bloque falla con un mensaje claro si algo no da lo esperado.
-- Usuarios: A (Venutto, prueba vigente), B (otro negocio) y C (prueba vencida).

-- Espera que una consulta falle con un mensaje que contenga "patron".
create or replace function pg_temp.espera_error(consulta text, patron text) returns void language plpgsql as $$
begin
  execute consulta;
  raise exception 'Se esperaba el error "%" y no falló: %', patron, consulta;
exception when others then
  if sqlerrm like 'Se esperaba el error%' then raise; end if;
  if position(lower(patron) in lower(sqlerrm)) = 0 then
    raise exception 'Error distinto al esperado. Esperado: "%". Recibido: "%"', patron, sqlerrm;
  end if;
end $$;
grant execute on function pg_temp.espera_error(text, text) to authenticated, anon;

insert into auth.users values
  ('aaaaaaaa-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000002'), ('cccccccc-0000-0000-0000-000000000003');
insert into public.negocios (id, owner_id, nombre) values
  ('a0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Venutto'),
  ('b0000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002', 'Otro');
insert into public.negocios (id, owner_id, nombre, prueba_hasta) values
  ('c0000000-0000-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-000000000003', 'Vencido', now() - interval '1 day');

insert into public.gastos (negocio_id, id, datos) values ('a0000000-0000-0000-0000-00000000000a', 'limpieza', '{"nombre":"Limpieza","monto":7000}');
insert into public.ajustes (negocio_id, id, datos) values
  ('a0000000-0000-0000-0000-00000000000a', 'general', '{"unidadesMes":120}'),
  ('a0000000-0000-0000-0000-00000000000a', 'delivery', '{"naftaMes":20000,"pedidosMes":80}');
insert into public.productos (negocio_id, id, datos) values
  ('a0000000-0000-0000-0000-00000000000a', 'lomito', '{"nombre":"Lomito completo","tipo":"producto","categoria":"Lomitos","precioVenta":10000,"envioIncluido":1000,
     "opciones":[{"id":"arabe","nombre":"pan árabe","reemplaza":"pan-frances","por":"pan-arabe","precioExtra":100}]}'),
  ('a0000000-0000-0000-0000-00000000000a', 'mayo', '{"nombre":"Pote de mayonesa","tipo":"extra","categoria":"Extras","precioVenta":500}'),
  ('a0000000-0000-0000-0000-00000000000a', 'promo3', '{"nombre":"Promo 3 lomitos","tipo":"promo","categoria":"Promos","precioVenta":27000,"envioIncluido":1000}'),
  ('a0000000-0000-0000-0000-00000000000a', 'mayocasera', '{"nombre":"Mayonesa casera","esPreparacion":true,"rinde":750}'),
  ('a0000000-0000-0000-0000-00000000000a', 'sinprecio', '{"nombre":"Hamburguesa nueva","precioVenta":null}'),
  ('a0000000-0000-0000-0000-00000000000a', 'oculto', '{"nombre":"Lomito viejo","precioVenta":9000,"enCaja":false}');

set role authenticated;

-- ---------- Usuario A ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

-- Sin caja abierta no se vende.
select pg_temp.espera_error($q$select public.confirmar_venta('11111111-0000-0000-0000-000000000001',
  '[{"producto":"lomito","cantidad":1,"costo_unitario":5200}]', '[{"medio":"efectivo","importe":10000}]')$q$, 'No hay una caja abierta');

-- El celular no puede escribir directo en las tablas.
select pg_temp.espera_error($q$insert into public.cajas (id, negocio_id, numero, fecha_operacion, saldo_inicial)
  values (gen_random_uuid(), 'a0000000-0000-0000-0000-00000000000a', 99, current_date, 0)$q$, 'permission denied');

select pg_temp.espera_error($q$select public.abrir_caja('22222222-0000-0000-0000-000000000000', -1)$q$, 'no puede ser negativo');

do $$
declare r jsonb;
begin
  r := public.abrir_caja('22222222-0000-0000-0000-000000000001', 20000);
  if (r->>'numero')::int <> 1 or (r->>'ya_estaba')::boolean then raise exception 'abrir_caja: %', r; end if;
  -- Otra apertura (otro celular, otro id) devuelve la misma caja abierta.
  r := public.abrir_caja('22222222-0000-0000-0000-000000000002', 5000);
  if r->>'id' <> '22222222-0000-0000-0000-000000000001' or not (r->>'ya_estaba')::boolean then raise exception 'segunda apertura: %', r; end if;
  if (select count(*) from public.cajas) <> 1 then raise exception 'hay más de una caja'; end if;
end $$;

-- Venta 1: lomito + pote de mayonesa, en efectivo.
do $$
declare r jsonb; v record;
begin
  r := public.confirmar_venta('11111111-0000-0000-0000-000000000001',
    '[{"producto":"lomito","cantidad":1,"costo_unitario":5200.004,"packaging_unitario":300,"costo_incompleto":false},
      {"producto":"mayo","cantidad":1,"costo_unitario":150,"costo_incompleto":true,"faltas":["la receta de Pote de mayonesa"]}]',
    '[{"medio":"efectivo","importe":10500}]');
  if (r->>'numero')::int <> 1 or (r->>'total')::numeric <> 10500 or (r->>'duplicada')::boolean then raise exception 'venta 1: %', r; end if;
  select * into v from public.ventas where id = '11111111-0000-0000-0000-000000000001';
  if v.bruto <> 10500 or v.costo_mercaderia <> 5350 or not v.costo_incompleto then raise exception 'venta 1 guardada mal: % % %', v.bruto, v.costo_mercaderia, v.costo_incompleto; end if;
  if (select count(*) from public.venta_items where venta_id = v.id) <> 2 then raise exception 'renglones'; end if;
  if (select envio_incluido_unitario from public.venta_items where venta_id = v.id and producto_id = 'lomito') <> 1000 then raise exception 'envío incluido'; end if;
  if (select faltas from public.venta_items where venta_id = v.id and producto_id = 'mayo') <> array['la receta de Pote de mayonesa'] then raise exception 'faltas'; end if;
end $$;

-- El mismo id otra vez (doble toque o reintento): no duplica, devuelve la venta guardada.
do $$
declare r jsonb;
begin
  r := public.confirmar_venta('11111111-0000-0000-0000-000000000001',
    '[{"producto":"lomito","cantidad":5,"costo_unitario":1}]', '[{"medio":"efectivo","importe":50000}]');
  if not (r->>'duplicada')::boolean or (r->>'total')::numeric <> 10500 then raise exception 'duplicado: %', r; end if;
  if (select count(*) from public.ventas) <> 1 then raise exception 'se duplicó la venta'; end if;
end $$;

-- El precio lo pone la base: aunque el celular mande otro número, se cobra el del catálogo.
-- Venta 2: promo dividida entre transferencia y efectivo, con envío.
do $$
declare r jsonb; v record;
begin
  r := public.confirmar_venta('11111111-0000-0000-0000-000000000002',
    '[{"producto":"promo3","cantidad":1,"costo_unitario":15600,"precio_unitario":1,"unidades":3}]',
    '[{"medio":"transferencia","importe":20000},{"medio":"efectivo","importe":8000}]', 0, null, 1000, true);
  select * into v from public.ventas where id = '11111111-0000-0000-0000-000000000002';
  if v.numero <> 2 or v.bruto <> 27000 or v.cargo_envio <> 1000 or v.total <> 28000 or not v.con_envio then raise exception 'venta 2: %', to_jsonb(v); end if;
  if (select sum(importe) from public.venta_pagos where venta_id = v.id) <> 28000 then raise exception 'pagos venta 2'; end if;
end $$;

-- Opción pan árabe: suma su precio extra y queda en el nombre.
do $$
declare r jsonb;
begin
  r := public.confirmar_venta('11111111-0000-0000-0000-000000000003',
    '[{"producto":"lomito","opcion":"arabe","cantidad":2,"costo_unitario":5300}]', '[{"medio":"transferencia","importe":20200}]');
  if (r->>'total')::numeric <> 20200 then raise exception 'opción: %', r; end if;
  if (select nombre from public.venta_items where venta_id = '11111111-0000-0000-0000-000000000003') <> 'Lomito completo (pan árabe)' then raise exception 'nombre opción'; end if;
end $$;

-- Descuento: necesita motivo y no puede superar la venta.
select pg_temp.espera_error($q$select public.confirmar_venta('11111111-0000-0000-0000-000000000004',
  '[{"producto":"lomito","cantidad":1,"costo_unitario":5200}]', '[{"medio":"efectivo","importe":9000}]', 1000)$q$, 'motivo del descuento');
select pg_temp.espera_error($q$select public.confirmar_venta('11111111-0000-0000-0000-000000000004',
  '[{"producto":"lomito","cantidad":1,"costo_unitario":5200}]', '[{"medio":"efectivo","importe":1}]', 10001, 'amigo')$q$, 'descuento no puede ser mayor');
do $$
declare r jsonb;
begin
  r := public.confirmar_venta('11111111-0000-0000-0000-000000000004',
    '[{"producto":"lomito","cantidad":1,"costo_unitario":5200}]', '[{"medio":"efectivo","importe":9000}]', 1000, 'Cliente frecuente');
  if (r->>'total')::numeric <> 9000 or (r->>'numero')::int <> 4 then raise exception 'descuento: %', r; end if;
end $$;

-- Pagos que no suman el total: falla y no queda nada guardado (ni la cabecera ni los renglones).
select pg_temp.espera_error($q$select public.confirmar_venta('11111111-0000-0000-0000-000000000005',
  '[{"producto":"lomito","cantidad":1,"costo_unitario":5200}]', '[{"medio":"efectivo","importe":9999}]')$q$, 'Los pagos suman');
select pg_temp.espera_error($q$select public.confirmar_venta('11111111-0000-0000-0000-000000000005',
  '[{"producto":"lomito","cantidad":1,"costo_unitario":5200}]', '[]')$q$, 'Los pagos suman');
select pg_temp.espera_error($q$select public.confirmar_venta('11111111-0000-0000-0000-000000000005',
  '[{"producto":"lomito","cantidad":1,"costo_unitario":5200}]', '[{"medio":"mercadopago","importe":10000}]')$q$, 'no habilitado');
select pg_temp.espera_error($q$select public.confirmar_venta('11111111-0000-0000-0000-000000000005',
  '[{"producto":"lomito","cantidad":1,"costo_unitario":5200}]', '[{"medio":"efectivo","importe":12000},{"medio":"transferencia","importe":-2000}]')$q$, 'mayor a $ 0');
do $$ begin
  if exists (select 1 from public.ventas where id = '11111111-0000-0000-0000-000000000005') then raise exception 'quedó una venta fallida guardada'; end if;
  if exists (select 1 from public.venta_items where venta_id = '11111111-0000-0000-0000-000000000005') then raise exception 'quedaron renglones de una venta fallida'; end if;
end $$;

-- Productos que no se pueden vender, cantidades y costos inválidos.
select pg_temp.espera_error($q$select public.confirmar_venta(gen_random_uuid(), '[]', '[]')$q$, 'no tiene productos');
select pg_temp.espera_error($q$select public.confirmar_venta(gen_random_uuid(),
  '[{"producto":"mayocasera","cantidad":1,"costo_unitario":1}]', '[{"medio":"efectivo","importe":1}]')$q$, 'preparación propia');
select pg_temp.espera_error($q$select public.confirmar_venta(gen_random_uuid(),
  '[{"producto":"sinprecio","cantidad":1,"costo_unitario":1}]', '[{"medio":"efectivo","importe":1}]')$q$, 'no tiene precio');
select pg_temp.espera_error($q$select public.confirmar_venta(gen_random_uuid(),
  '[{"producto":"oculto","cantidad":1,"costo_unitario":1}]', '[{"medio":"efectivo","importe":9000}]')$q$, 'no está a la venta');
select pg_temp.espera_error($q$select public.confirmar_venta(gen_random_uuid(),
  '[{"producto":"no-existe","cantidad":1,"costo_unitario":1}]', '[{"medio":"efectivo","importe":1}]')$q$, 'ya no existe');
select pg_temp.espera_error($q$select public.confirmar_venta(gen_random_uuid(),
  '[{"producto":"lomito","cantidad":0,"costo_unitario":1}]', '[{"medio":"efectivo","importe":1}]')$q$, 'Cantidad inválida');
select pg_temp.espera_error($q$select public.confirmar_venta(gen_random_uuid(),
  '[{"producto":"lomito","cantidad":1.5,"costo_unitario":1}]', '[{"medio":"efectivo","importe":1}]')$q$, 'Cantidad inválida');
select pg_temp.espera_error($q$select public.confirmar_venta(gen_random_uuid(),
  '[{"producto":"lomito","cantidad":1,"costo_unitario":-5}]', '[{"medio":"efectivo","importe":10000}]')$q$, 'Costo inválido');
select pg_temp.espera_error($q$select public.confirmar_venta(gen_random_uuid(),
  '[{"producto":"lomito","opcion":"no-existe","cantidad":1,"costo_unitario":1}]', '[{"medio":"efectivo","importe":10000}]')$q$, 'opción elegida');

do $$ begin
  if (select count(*) from public.ventas) <> 4 then raise exception 'A debería tener 4 ventas, tiene %', (select count(*) from public.ventas); end if;
end $$;

-- Resumen de la caja (Fase 3). Cuentas a mano:
-- ventas brutas 10.500 + 27.000 + 20.200 + 10.000 = 67.700; descuentos 1.000; netas 66.700; envíos 1.000
-- costo de mercadería 5.200 + 150 + 15.600 + 2 × 5.300 + 5.200 = 36.750; margen bruto 29.950
-- unidades 1 + 1 + 3 (promo) + 2 + 1 = 8; gasto fijo 7.000 / 120 = 58,33 → 466,64; nafta 20.000 / 80 = 250 × 1 pedido
-- resultado = 29.950 + 1.000 − 466,64 − 250 = 30.233,36
do $$
declare r jsonb;
begin
  r := public.resumen_caja('22222222-0000-0000-0000-000000000001');
  if (r->>'ventas')::int <> 4 then raise exception 'resumen ventas: %', r; end if;
  if (r->>'ventas_brutas')::numeric <> 67700 or (r->>'descuentos')::numeric <> 1000 or (r->>'ventas_netas')::numeric <> 66700 then raise exception 'resumen ventas netas: %', r; end if;
  if (r->>'envios_cobrados')::numeric <> 1000 or (r->>'total_cobrado')::numeric <> 67700 then raise exception 'resumen cobrado: %', r; end if;
  if (r->>'costo_mercaderia')::numeric <> 36750 or (r->>'margen_bruto')::numeric <> 29950 then raise exception 'resumen margen: %', r; end if;
  if (r->>'unidades')::int <> 8 or (r->>'gasto_fijo_por_unidad')::numeric <> 58.33 or (r->>'gastos_fijos_estimados')::numeric <> 466.64 then raise exception 'resumen fijos: %', r; end if;
  if (r->>'nafta_estimada')::numeric <> 250 or (r->>'resultado_estimado')::numeric <> 30233.36 then raise exception 'resumen resultado: %', r; end if;
  if (r->'por_medio'->>'efectivo')::numeric <> 27500 or (r->'por_medio'->>'transferencia')::numeric <> 40200 then raise exception 'resumen medios: %', r; end if;
  if (r->>'ventas_costo_incompleto')::int <> 1 or r->'productos_costo_incompleto' <> '["Pote de mayonesa"]'::jsonb then raise exception 'resumen incompletos: %', r; end if;
  if (r->>'envio_incluido_en_precios')::numeric <> 5000 then raise exception 'resumen envío incluido: %', r; end if;
  if r->'por_producto'->0->>'nombre' <> 'Promo 3 lomitos' or (r->'por_producto'->0->>'margen')::numeric <> 11400 then raise exception 'resumen por producto: %', r->'por_producto'; end if;
end $$;

-- ---------- Usuario B: no ve ni toca lo de A ----------
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  if (select count(*) from public.ventas) <> 0 or (select count(*) from public.cajas) <> 0
     or (select count(*) from public.venta_items) <> 0 or (select count(*) from public.venta_pagos) <> 0 then
    raise exception 'B ve datos de A';
  end if;
end $$;
select public.abrir_caja('33333333-0000-0000-0000-000000000001', 0);
select pg_temp.espera_error($q$select public.confirmar_venta('11111111-0000-0000-0000-000000000001',
  '[{"producto":"lomito","cantidad":1,"costo_unitario":1}]', '[{"medio":"efectivo","importe":10000}]')$q$, 'Id de venta inválido');
select pg_temp.espera_error($q$select public.resumen_caja('22222222-0000-0000-0000-000000000001')$q$, 'No se encontró la caja');
-- B no puede vender productos de A.
select pg_temp.espera_error($q$select public.confirmar_venta(gen_random_uuid(),
  '[{"producto":"lomito","cantidad":1,"costo_unitario":1}]', '[{"medio":"efectivo","importe":10000}]')$q$, 'ya no existe');
do $$ begin
  if (select numero from public.cajas) <> 1 then raise exception 'la numeración de cajas de B no empieza en 1'; end if;
end $$;

-- ---------- Usuario C: prueba vencida, sin suscripción ----------
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false);
select pg_temp.espera_error($q$select public.abrir_caja(gen_random_uuid(), 0)$q$, 'no tiene acceso');

-- ---------- Sin sesión ----------
reset role;
set role anon;
select pg_temp.espera_error($q$select public.abrir_caja(gen_random_uuid(), 0)$q$, 'permission denied');
reset role;

-- La base misma impide dos cajas abiertas (aunque alguien saltee las funciones).
select pg_temp.espera_error($q$insert into public.cajas (id, negocio_id, numero, fecha_operacion, saldo_inicial)
  values (gen_random_uuid(), 'a0000000-0000-0000-0000-00000000000a', 50, current_date, 0)$q$, 'cajas_una_abierta');

-- =====================================================================
-- Fase 4: la noche de ejemplo del diseño (fase-1-diseno.md, sección 8), con gastos fijos de $ 225 por producto
-- y nafta de $ 250 por pedido. Usuario D, otro negocio, para que los números sean exactamente los del ejemplo.
-- =====================================================================
insert into auth.users values ('dddddddd-0000-0000-0000-000000000004');
insert into public.negocios (id, owner_id, nombre) values ('d0000000-0000-0000-0000-00000000000d', 'dddddddd-0000-0000-0000-000000000004', 'Ejemplo');
insert into public.gastos (negocio_id, id, datos) values ('d0000000-0000-0000-0000-00000000000d', 'fijos', '{"nombre":"Fijos","monto":22500}');
insert into public.ajustes (negocio_id, id, datos) values
  ('d0000000-0000-0000-0000-00000000000d', 'general', '{"unidadesMes":100}'),
  ('d0000000-0000-0000-0000-00000000000d', 'delivery', '{"naftaMes":25000,"pedidosMes":100}');
insert into public.productos (negocio_id, id, datos) values
  ('d0000000-0000-0000-0000-00000000000d', 'lomito', '{"nombre":"Lomito completo","precioVenta":10000,"envioIncluido":1000}'),
  ('d0000000-0000-0000-0000-00000000000d', 'mayo', '{"nombre":"Pote de mayonesa","tipo":"extra","precioVenta":500}'),
  ('d0000000-0000-0000-0000-00000000000d', 'promo3', '{"nombre":"Promo 3 lomitos","tipo":"promo","precioVenta":27000,"envioIncluido":1000}');

set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);

-- Sin caja abierta no hay movimientos ni anulaciones.
select pg_temp.espera_error($q$select public.registrar_movimiento(gen_random_uuid(), 'retiro', 'efectivo', 100)$q$, 'No hay una caja abierta');

-- 20:00 abrir con $ 20.000 · 20:40 Venta 1 · 21:15 Venta 2 (y su doble toque) · 22:00 compra de pan · 23:30 retiro · 00:30 reserva
do $$
declare r jsonb;
begin
  perform public.abrir_caja('d1000000-0000-0000-0000-000000000001', 20000);
  perform public.confirmar_venta('d2000000-0000-0000-0000-000000000001',
    '[{"producto":"lomito","cantidad":1,"costo_unitario":5200,"packaging_unitario":300},{"producto":"mayo","cantidad":1,"costo_unitario":150}]',
    '[{"medio":"efectivo","importe":10500}]');
  perform public.confirmar_venta('d2000000-0000-0000-0000-000000000002',
    '[{"producto":"promo3","cantidad":1,"costo_unitario":15600,"unidades":3}]',
    '[{"medio":"transferencia","importe":20000},{"medio":"efectivo","importe":8000}]', 0, null, 1000, true);
  r := public.confirmar_venta('d2000000-0000-0000-0000-000000000002',
    '[{"producto":"promo3","cantidad":1,"costo_unitario":15600,"unidades":3}]',
    '[{"medio":"transferencia","importe":20000},{"medio":"efectivo","importe":8000}]', 0, null, 1000, true);
  if not (r->>'duplicada')::boolean then raise exception 'doble toque: %', r; end if;
  perform public.registrar_movimiento('d3000000-0000-0000-0000-000000000001', 'compra_mercaderia', 'efectivo', 6000, 'Pan');
  perform public.registrar_movimiento('d3000000-0000-0000-0000-000000000002', 'retiro', 'efectivo', 10000, null);
  perform public.registrar_movimiento('d3000000-0000-0000-0000-000000000003', 'reserva', 'efectivo', 15000, 'Para reponer');
  -- El mismo movimiento dos veces no se duplica.
  r := public.registrar_movimiento('d3000000-0000-0000-0000-000000000002', 'retiro', 'efectivo', 10000, null);
  if not (r->>'duplicado')::boolean or (select count(*) from public.movimientos) <> 3 then raise exception 'movimiento duplicado: %', r; end if;
end $$;

-- Movimientos inválidos: nada queda guardado.
select pg_temp.espera_error($q$select public.registrar_movimiento(gen_random_uuid(), 'propina', 'efectivo', 100)$q$, 'Tipo de movimiento inválido');
select pg_temp.espera_error($q$select public.registrar_movimiento(gen_random_uuid(), 'retiro', 'mercadopago', 100)$q$, 'no habilitado');
select pg_temp.espera_error($q$select public.registrar_movimiento(gen_random_uuid(), 'retiro', 'efectivo', 0)$q$, 'mayor a $ 0');
select pg_temp.espera_error($q$select public.registrar_movimiento(gen_random_uuid(), 'aporte', 'efectivo', -50)$q$, 'mayor a $ 0');
select pg_temp.espera_error($q$select public.registrar_movimiento(gen_random_uuid(), 'gasto', 'efectivo', 100, '  ')$q$, 'Escribí qué pagaste');
select pg_temp.espera_error($q$select public.registrar_movimiento(gen_random_uuid(), 'ajuste', 'efectivo', -100)$q$, 'motivo del ajuste');
-- No puede salir más efectivo del que hay: se esperan $ 22.500.
select pg_temp.espera_error($q$select public.registrar_movimiento(gen_random_uuid(), 'retiro', 'efectivo', 22500.01)$q$, 'debería haber $ 22.500 en efectivo');
select pg_temp.espera_error($q$update public.movimientos set importe = 1$q$, 'permission denied');
select pg_temp.espera_error($q$update public.ventas set estado = 'anulada'$q$, 'permission denied');
do $$ begin
  if (select count(*) from public.movimientos) <> 3 then raise exception 'quedó guardado un movimiento inválido'; end if;
end $$;

-- Informe en vivo antes de cerrar. Cuentas del ejemplo:
-- margen 37.500 − 20.950 = 16.550; resultado 16.550 + 1.000 − 0 − 5 × 225 − 1 × 250 = 16.175 (la compra de pan no cuenta)
-- efectivo esperado 20.000 + 10.500 + 8.000 − 6.000 − 10.000 = 22.500 (la reserva no saca plata)
do $$
declare r jsonb;
begin
  r := public.resumen_caja('d1000000-0000-0000-0000-000000000001');
  if (r->>'ventas_netas')::numeric <> 37500 or (r->>'costo_mercaderia')::numeric <> 20950 or (r->>'margen_bruto')::numeric <> 16550 then raise exception 'ejemplo margen: %', r; end if;
  if (r->>'gastos_fijos_estimados')::numeric <> 1125 or (r->>'nafta_estimada')::numeric <> 250 or (r->>'resultado_estimado')::numeric <> 16175 then raise exception 'ejemplo resultado: %', r; end if;
  if (r->>'compras_mercaderia')::numeric <> 6000 or (r->>'retiros')::numeric <> 10000 or (r->>'reserva_apartada')::numeric <> 15000 then raise exception 'ejemplo movimientos: %', r; end if;
  if (r->>'efectivo_esperado')::numeric <> 22500 or (r->>'transferencias_esperadas')::numeric <> 20000 then raise exception 'ejemplo efectivo: %', r; end if;
  if (r->>'reserva_sugerida')::numeric <> 20950 then raise exception 'ejemplo reserva sugerida: %', r; end if;
end $$;

-- 00:45 cierre: contaste $ 22.300 (faltan $ 200). Sin observación no deja cerrar; con observación, sí.
select pg_temp.espera_error($q$select public.cerrar_caja('d1000000-0000-0000-0000-000000000001', 22300, 20000, 20000, null)$q$,
  'diferencia de − $ 200 en efectivo');
select pg_temp.espera_error($q$select public.cerrar_caja('d1000000-0000-0000-0000-000000000001', 22300, 20000, 22301, 'x')$q$, 'no puede ser más que el efectivo contado');
select pg_temp.espera_error($q$select public.cerrar_caja('d1000000-0000-0000-0000-000000000001', -1, null, 0, 'x')$q$, 'efectivo que contaste');
do $$
declare r jsonb; c record;
begin
  if (select estado from public.cajas where id = 'd1000000-0000-0000-0000-000000000001') <> 'abierta' then raise exception 'un cierre fallido cerró la caja'; end if;
  r := public.cerrar_caja('d1000000-0000-0000-0000-000000000001', 22300, 20000, 20000, 'Faltan 200, vuelto mal dado');
  -- Disponible = 22.300 + 20.000 − 20.000 de fondo − 15.000 de reserva = 7.300
  if (r->>'diferencia_efectivo')::numeric <> -200 or (r->>'diferencia_transferencias')::numeric <> 0 or (r->>'disponible_estimado')::numeric <> 7300 then raise exception 'cierre: %', r; end if;
  if (r->>'resultado_estimado')::numeric <> 16175 or (r->>'ya_estaba')::boolean then raise exception 'cierre resultado: %', r; end if;
  select * into c from public.cajas where id = 'd1000000-0000-0000-0000-000000000001';
  if c.estado <> 'cerrada' or c.efectivo_esperado <> 22500 or c.efectivo_contado <> 22300 or c.diferencia_efectivo <> -200
     or c.fondo_siguiente <> 20000 or c.observaciones <> 'Faltan 200, vuelto mal dado' or (c.resumen->>'disponible_estimado')::numeric <> 7300 then
    raise exception 'caja cerrada mal guardada: %', to_jsonb(c);
  end if;
  -- Reintento del cierre (el celular no recibió la respuesta): devuelve el mismo informe, no cambia nada.
  r := public.cerrar_caja('d1000000-0000-0000-0000-000000000001', 1, null, 0, 'otro');
  if not (r->>'ya_estaba')::boolean or (r->>'efectivo_contado')::numeric <> 22300 then raise exception 'cierre repetido: %', r; end if;
  if (select count(*) from public.auditoria where accion = 'cerrar_caja' and negocio_id = 'd0000000-0000-0000-0000-00000000000d') <> 1 then raise exception 'auditoría del cierre'; end if;
end $$;

-- Caja cerrada: no se vende, no se cargan ni se anulan movimientos.
select pg_temp.espera_error($q$select public.confirmar_venta(gen_random_uuid(), '[{"producto":"mayo","cantidad":1,"costo_unitario":150}]', '[{"medio":"efectivo","importe":500}]')$q$, 'No hay una caja abierta');
select pg_temp.espera_error($q$select public.registrar_movimiento(gen_random_uuid(), 'aporte', 'efectivo', 100)$q$, 'No hay una caja abierta');
select pg_temp.espera_error($q$select public.anular_movimiento('d3000000-0000-0000-0000-000000000002', 'error')$q$, 'ya está cerrada');
select pg_temp.espera_error($q$select public.anular_venta('d2000000-0000-0000-0000-000000000001', 'error')$q$, 'Abrí la caja para anular');

-- Día siguiente: se abre la Caja 2 y se anula la Venta 1 de ayer. El cierre de ayer no cambia.
do $$
declare r jsonb; r1 jsonb;
begin
  r1 := public.resumen_caja('d1000000-0000-0000-0000-000000000001');
  perform public.abrir_caja('d1000000-0000-0000-0000-000000000002', 20000);
  perform pg_temp.espera_error($q$select public.anular_venta('d2000000-0000-0000-0000-000000000001', ' ')$q$, 'motivo de la anulación');
  r := public.anular_venta('d2000000-0000-0000-0000-000000000001', 'Se cobró mal');
  if (r->>'misma_caja')::boolean or (r->>'ya_estaba')::boolean then raise exception 'anulación de ayer: %', r; end if;
  r := public.anular_venta('d2000000-0000-0000-0000-000000000001', 'Otra vez');
  if not (r->>'ya_estaba')::boolean then raise exception 'anulación repetida: %', r; end if;
  if public.resumen_caja('d1000000-0000-0000-0000-000000000001') <> r1 then raise exception 'el cierre de ayer cambió después de la anulación'; end if;
  r := public.resumen_caja('d1000000-0000-0000-0000-000000000002');
  if (r->>'anulaciones_anteriores_total')::numeric <> 10500 or r->'anulaciones_anteriores'->0->>'venta' <> '1' or r->'anulaciones_anteriores'->0->>'caja' <> '1' then raise exception 'anulaciones anteriores: %', r; end if;
  if (r->>'ventas')::int <> 0 or (r->>'efectivo_esperado')::numeric <> 20000 then raise exception 'la anulación de ayer movió la caja de hoy: %', r; end if;
end $$;

-- En la caja de hoy: una venta anulada en la misma caja deja de contar (la plata se devolvió).
-- Un gasto del día resta del resultado; uno que ya está en los gastos fijos, no. Anular un movimiento lo saca de las cuentas.
do $$
declare r jsonb;
begin
  perform public.confirmar_venta('d2000000-0000-0000-0000-000000000003', '[{"producto":"lomito","cantidad":1,"costo_unitario":5200}]', '[{"medio":"efectivo","importe":10000}]');
  perform public.confirmar_venta('d2000000-0000-0000-0000-000000000004', '[{"producto":"mayo","cantidad":2,"costo_unitario":150}]', '[{"medio":"transferencia","importe":1000}]');
  r := public.anular_venta('d2000000-0000-0000-0000-000000000003', 'El cliente se arrepintió');
  if not (r->>'misma_caja')::boolean then raise exception 'misma caja: %', r; end if;
  perform public.registrar_movimiento('d3000000-0000-0000-0000-000000000011', 'gasto', 'efectivo', 3000, 'Garrafa de gas');
  perform public.registrar_movimiento('d3000000-0000-0000-0000-000000000012', 'gasto', 'transferencia', 7000, 'Limpieza del mes', true);
  perform public.registrar_movimiento('d3000000-0000-0000-0000-000000000013', 'ajuste', 'efectivo', -500, 'Billete roto');
  perform public.registrar_movimiento('d3000000-0000-0000-0000-000000000014', 'aporte', 'efectivo', 2000, 'Cambio');
  r := public.resumen_caja('d1000000-0000-0000-0000-000000000002');
  -- Ventas: solo los 2 potes (1.000, costo 300). Resultado = 700 − 3.000 de gas − 2 × 225 = −2.750
  if (r->>'ventas')::int <> 1 or (r->>'anuladas')::int <> 1 or (r->>'anuladas_total')::numeric <> 10000 then raise exception 'anuladas: %', r; end if;
  if (r->>'gastos_operativos')::numeric <> 3000 or (r->>'gastos_en_fijos')::numeric <> 7000 or (r->>'resultado_estimado')::numeric <> -2750 then raise exception 'gastos: %', r; end if;
  -- Efectivo = 20.000 − 3.000 − 500 + 2.000 = 18.500 · transferencias = 1.000 − 7.000 = −6.000
  if (r->>'efectivo_esperado')::numeric <> 18500 or (r->>'transferencias_esperadas')::numeric <> -6000 or (r->>'ajustes')::numeric <> -500 then raise exception 'caja de hoy: %', r; end if;
  perform pg_temp.espera_error($q$select public.anular_movimiento('d3000000-0000-0000-0000-000000000011', '')$q$, 'motivo de la anulación');
  r := public.anular_movimiento('d3000000-0000-0000-0000-000000000011', 'Lo pagó otro');
  r := public.resumen_caja('d1000000-0000-0000-0000-000000000002');
  if (r->>'gastos_operativos')::numeric <> 0 or (r->>'efectivo_esperado')::numeric <> 21500 or (r->>'resultado_estimado')::numeric <> 250 then raise exception 'anular movimiento: %', r; end if;
  if (select count(*) from public.auditoria where negocio_id = 'd0000000-0000-0000-0000-00000000000d' and accion in ('anular_venta', 'anular_movimiento', 'movimiento')) <> 10 then
    raise exception 'auditoría: % filas', (select count(*) from public.auditoria where negocio_id = 'd0000000-0000-0000-0000-00000000000d' and accion in ('anular_venta', 'anular_movimiento', 'movimiento'));
  end if;
end $$;

-- Pagos pendientes (Fase 6): los carga el dueño en Informes (en Supabase, con los permisos de la tabla ajustes).
-- Los que no tienen un monto válido no cuentan.
reset role;
insert into public.ajustes (negocio_id, id, datos) values ('d0000000-0000-0000-0000-00000000000d', 'obligaciones',
  '{"items":[{"nombre":"Proveedor de carne","monto":300,"vence":"2026-11-10"},{"nombre":"Mal","monto":"abc"},{"nombre":"Negativo","monto":-5},{"nombre":"Sin monto"},{"nombre":"Fecha rara","monto":"0.5","vence":"mañana"}]}');
set role authenticated;

-- Sin diferencias, se cierra sin observación. El fondo queda propuesto para abrir mañana.
do $$
declare r jsonb;
begin
  r := public.resumen_caja('d1000000-0000-0000-0000-000000000002');
  if (r->>'obligaciones_pendientes')::numeric <> 300.5 or jsonb_array_length(r->'obligaciones') <> 2 then raise exception 'pagos pendientes: %', r; end if;
  r := public.cerrar_caja('d1000000-0000-0000-0000-000000000002', 21500, null, 15000, null);
  if (r->>'diferencia_efectivo')::numeric <> 0 or r->>'diferencia_transferencias' is not null then raise exception 'cierre sin diferencias: %', r; end if;
  -- Sin dato del banco, el disponible usa las transferencias esperadas: 21.500 − 6.000 − 15.000 − 0 de reserva − 300,50 pendientes = 199,50
  if (r->>'disponible_estimado')::numeric <> 199.5 then raise exception 'disponible sin banco: %', r; end if;
  if r->'obligaciones'->0->>'vence' <> '2026-11-10' or r->'obligaciones'->1->'vence' <> 'null'::jsonb then raise exception 'vencimientos: %', r; end if;
end $$;
-- La foto del cierre no cambia si después se paga (se borra) el pendiente.
reset role;
delete from public.ajustes where negocio_id = 'd0000000-0000-0000-0000-00000000000d' and id = 'obligaciones';
set role authenticated;
do $$ begin
  if (public.resumen_caja('d1000000-0000-0000-0000-000000000002')->>'disponible_estimado')::numeric <> 199.5 then raise exception 'la foto cambió'; end if;
end $$;

-- Otro negocio no puede anular, cargar ni cerrar lo de D.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
select pg_temp.espera_error($q$select public.anular_venta('d2000000-0000-0000-0000-000000000004', 'x')$q$, 'No se encontró la venta');
select pg_temp.espera_error($q$select public.anular_movimiento('d3000000-0000-0000-0000-000000000012', 'x')$q$, 'No se encontró el movimiento');
select pg_temp.espera_error($q$select public.cerrar_caja('d1000000-0000-0000-0000-000000000002', 0)$q$, 'No se encontró la caja');
select pg_temp.espera_error($q$select public.registrar_movimiento('d3000000-0000-0000-0000-000000000012', 'aporte', 'efectivo', 1)$q$, 'Id de movimiento inválido');
do $$ begin
  if (select count(*) from public.movimientos) <> 0 then raise exception 'B ve movimientos de D'; end if;
end $$;
-- Nadie llama directo al cálculo interno.
select pg_temp.espera_error($q$select public.caja_informe(c) from public.cajas c$q$, 'permission denied');
reset role;

-- =====================================================================
-- Fase 7: copia de seguridad y restauración.
-- D descarga su copia, se pierde todo lo de D en la base y D la restaura: tiene que quedar exactamente igual.
-- =====================================================================
create temp table copia_d (c jsonb);
grant all on copia_d to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
insert into copia_d select public.copia_negocio();
do $$
declare c jsonb := (select c from copia_d);
begin
  if c->>'formato' <> 'calculadora-copia' or jsonb_array_length(c->'cajas') <> 2 or jsonb_array_length(c->'ventas') <> 4
     or jsonb_array_length(c->'productos') <> 3 or jsonb_array_length(c->'venta_items') = 0 or jsonb_array_length(c->'movimientos') = 0 then
    raise exception 'copia incompleta: % cajas, % ventas', jsonb_array_length(c->'cajas'), jsonb_array_length(c->'ventas');
  end if;
  if c ? 'negocio_id' or (c->'cajas'->0) ? 'negocio_id' then raise exception 'la copia no debería llevar el id del negocio'; end if;
end $$;
-- Con datos en la caja, restaurar no toca nada (no se puede mezclar una copia con ventas reales).
do $$
declare r jsonb := public.restaurar_copia((select c from copia_d));
begin
  if not (r->>'caja_ya_tenia')::boolean or (r->>'ventas')::int <> 0 or (r->>'productos')::int <> 0 then raise exception 'restaurar encima: %', r; end if;
end $$;
select pg_temp.espera_error($q$select public.restaurar_copia('{"formato":"otro"}')$q$, 'no es una copia de seguridad');
select pg_temp.espera_error($q$select public.restaurar_copia('{"formato":"calculadora-copia","version":2}')$q$, 'otra versión');
-- Un archivo que no es una copia no deja nada a medias.
select pg_temp.espera_error($q$select public.restaurar_copia('[1,2]')$q$, 'no es una copia de seguridad');

-- Se pierde todo lo de D.
reset role;
delete from public.venta_pagos p using public.ventas v where v.id = p.venta_id and v.negocio_id = 'd0000000-0000-0000-0000-00000000000d';
delete from public.venta_items i using public.ventas v where v.id = i.venta_id and v.negocio_id = 'd0000000-0000-0000-0000-00000000000d';
delete from public.movimientos where negocio_id = 'd0000000-0000-0000-0000-00000000000d';
update public.ventas set anulada_en_caja = null where negocio_id = 'd0000000-0000-0000-0000-00000000000d';
delete from public.ventas where negocio_id = 'd0000000-0000-0000-0000-00000000000d';
delete from public.cajas where negocio_id = 'd0000000-0000-0000-0000-00000000000d';
delete from public.auditoria where negocio_id = 'd0000000-0000-0000-0000-00000000000d';
delete from public.productos where negocio_id = 'd0000000-0000-0000-0000-00000000000d';
delete from public.gastos where negocio_id = 'd0000000-0000-0000-0000-00000000000d';
delete from public.ajustes where negocio_id = 'd0000000-0000-0000-0000-00000000000d' and id = 'general';

set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
do $$
declare
  antes jsonb := (select c from copia_d);
  r jsonb := public.restaurar_copia(antes);
  despues jsonb := public.copia_negocio();
  aud jsonb;
begin
  -- El ajuste "delivery" no se había borrado: queda el que había, no se duplica.
  if (r->>'cajas')::int <> 2 or (r->>'ventas')::int <> 4 or (r->>'productos')::int <> 3 or (r->>'ajustes')::int <> 1 or (r->>'gastos')::int <> 1 then
    raise exception 'restaurar: %', r;
  end if;
  if (despues - 'creada_en' - 'auditoria') <> (antes - 'creada_en' - 'auditoria') then raise exception 'lo restaurado no es igual a la copia'; end if;
  aud := despues->'auditoria';
  if jsonb_array_length(aud) <> jsonb_array_length(antes->'auditoria') + 1 or aud->-1->>'accion' <> 'restaurar_copia'
     or (aud - (jsonb_array_length(aud) - 1)) <> antes->'auditoria' then
    raise exception 'auditoría restaurada: %', aud->-1;
  end if;
  -- Los informes guardados vuelven iguales y la caja sigue funcionando: la próxima es la Caja 3.
  if (public.resumen_caja('d1000000-0000-0000-0000-000000000001')->>'disponible_estimado')::numeric <> 7300 then raise exception 'informe restaurado'; end if;
  if (public.abrir_caja('d1000000-0000-0000-0000-000000000003', 15000)->>'numero')::int <> 3 then raise exception 'numeración después de restaurar'; end if;
  -- Restaurar otra vez no duplica nada.
  r := public.restaurar_copia(antes);
  if not (r->>'caja_ya_tenia')::boolean or (r->>'productos')::int <> 0 or (r->>'insumos')::int <> 0 then raise exception 'restaurar dos veces: %', r; end if;
end $$;

-- Otro negocio (B) intenta cargar la copia de D: recibe el catálogo, pero ninguna venta ni caja de D (son de otro negocio),
-- y lo de D no cambia.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
declare r jsonb := public.restaurar_copia((select c from copia_d));
begin
  if (r->>'cajas')::int <> 0 or (r->>'ventas')::int <> 0 or (r->>'movimientos')::int <> 0 then raise exception 'B restauró cajas de D: %', r; end if;
  if exists (select 1 from public.ventas) then raise exception 'B ve ventas de D'; end if;
end $$;
-- Un negocio vencido no puede descargar ni restaurar.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false);
select pg_temp.espera_error($q$select public.copia_negocio()$q$, 'no tiene acceso');
select pg_temp.espera_error($q$select public.restaurar_copia((select c from copia_d))$q$, 'no tiene acceso');
reset role;
set role anon;
select pg_temp.espera_error($q$select public.copia_negocio()$q$, 'permission denied');
reset role;
do $$ begin
  if (select count(*) from public.ventas where negocio_id = 'd0000000-0000-0000-0000-00000000000d') <> 4 then raise exception 'ventas de D cambiaron'; end if;
end $$;
