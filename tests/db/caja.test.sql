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
    '[{"producto":"promo3","cantidad":1,"costo_unitario":15600,"precio_unitario":1}]',
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
