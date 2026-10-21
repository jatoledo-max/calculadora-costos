-- Pruebas de whatsapp.sql: pedidos del asistente, estados, fila de mensajes y quién ve qué.
-- Corre después de menu.test.sql (usa sus negocios y productos: mcompleto $11.500, opción árabe +$300, envío $1.000).
reset role;
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

-- Menú despublicado: el asistente no tiene contexto y no puede registrar pedidos.
do $$ begin
  if public.wa_contexto('venutto') is not null then raise exception 'Contexto con el menú despublicado'; end if;
end $$;
select pg_temp.espera_error($q$select public.wa_registrar_pedido('venutto','5493850000001',null,'[{"producto":"mcompleto","cantidad":1}]','retiro','efectivo',null,null,null)$q$, 'no está disponible');

update public.ajustes set datos = jsonb_set(datos, '{publicado}', 'true') where id = 'menu' and negocio_id = 'a0000000-0000-0000-0000-00000000000a';
do $$
declare c jsonb;
begin
  c := public.wa_contexto('venutto');
  if c->>'negocio_id' <> 'a0000000-0000-0000-0000-00000000000a' then raise exception 'negocio equivocado: %', c; end if;
  if (c->>'activo')::boolean then raise exception 'El asistente arranca apagado'; end if;
  if (c->'publico'->'menu'->>'envio')::numeric <> 1000 then raise exception 'falta el menú: %', c; end if;
end $$;
insert into public.ajustes (negocio_id, id, datos) values ('a0000000-0000-0000-0000-00000000000a', 'whatsapp', '{"activo":true}');
do $$ begin
  if not (public.wa_contexto('venutto')->>'activo')::boolean then raise exception 'No se encendió'; end if;
end $$;

-- Pedido: el importe lo calcula la base; la IA solo manda productos y cantidades.
do $$
declare r jsonb; p public.wa_pedidos;
begin
  r := public.wa_registrar_pedido('venutto', '5493850000001', 'Marta',
    '[{"producto":"mcompleto","opcion":"arabe","cantidad":2,"precio_unitario":1}]', 'delivery', 'efectivo',
    '{"lat":-27.78,"lng":-64.26}', null, 'sin cebolla');
  if not (r->>'ok')::boolean or (r->>'numero')::int <> 1 or (r->>'total')::numeric <> 2*11800 + 1000 then raise exception 'pedido mal: %', r; end if;
  select * into p from public.wa_pedidos where numero = 1;
  if p.estado <> 'nuevo' or p.subtotal <> 23600 or p.envio <> 1000 or p.notas <> 'sin cebolla' or p.ubicacion->>'lat' <> '-27.78' then raise exception 'guardado mal: %', to_jsonb(p); end if;

  -- El mismo cliente confirma lo mismo otra vez (reintento): no se duplica.
  r := public.wa_registrar_pedido('venutto', '5493850000001', 'Marta', '[{"producto":"mcompleto","opcion":"arabe","cantidad":2}]', 'delivery', 'efectivo', null, null, null);
  if not (r->>'repetido')::boolean or (r->>'numero')::int <> 1 then raise exception 'pedido duplicado: %', r; end if;

  -- Otro pedido distinto sí suma número.
  r := public.wa_registrar_pedido('venutto', '5493850000002', null, '[{"producto":"mpote","cantidad":3}]', 'retiro', 'transferencia', null, null, null);
  if (r->>'numero')::int <> 2 or (r->>'total')::numeric <> 1500 then raise exception 'segundo pedido mal: %', r; end if;

  -- Producto agotado o que no está en el menú: no se registra y se dice por qué.
  r := public.wa_registrar_pedido('venutto', '5493850000003', null, '[{"producto":"magotado","cantidad":1}]', 'retiro', 'efectivo', null, null, null);
  if (r->>'ok')::boolean or r->'errores'->0->>'error' <> 'agotado' then raise exception 'aceptó un agotado: %', r; end if;
  r := public.wa_registrar_pedido('venutto', '5493850000003', null, '[{"producto":"mnomenu","cantidad":1}]', 'retiro', 'efectivo', null, null, null);
  if (r->>'ok')::boolean then raise exception 'aceptó un producto fuera del menú: %', r; end if;
  if (select count(*) from public.wa_pedidos) <> 2 then raise exception 'se guardaron pedidos con errores'; end if;
end $$;
select pg_temp.espera_error($q$select public.wa_registrar_pedido('venutto','5493850000004',null,'[{"producto":"mpote","cantidad":1}]','retiro','bitcoin',null,null,null)$q$, 'Medio de pago');

-- Estados: solo hacia adelante; rechazar solo antes de preparar; de otro negocio, nada.
do $$
declare id1 uuid; id2 uuid; p public.wa_pedidos;
begin
  select id into id1 from public.wa_pedidos where numero = 1;
  select id into id2 from public.wa_pedidos where numero = 2;
  p := public.wa_cambiar_estado(id1, 'a0000000-0000-0000-0000-00000000000a', 'aceptado', null);
  if p.estado <> 'aceptado' then raise exception 'no aceptó'; end if;
  p := public.wa_cambiar_estado(id1, 'a0000000-0000-0000-0000-00000000000a', 'en_preparacion', null);
  p := public.wa_cambiar_estado(id2, 'a0000000-0000-0000-0000-00000000000a', 'rechazado', '  Sin stock ');
  if p.motivo_rechazo <> 'Sin stock' then raise exception 'motivo mal: %', p.motivo_rechazo; end if;
end $$;
select pg_temp.espera_error($q$select public.wa_cambiar_estado((select id from public.wa_pedidos where numero = 1), 'a0000000-0000-0000-0000-00000000000a', 'aceptado', null)$q$, 'ya pasó');
select pg_temp.espera_error($q$select public.wa_cambiar_estado((select id from public.wa_pedidos where numero = 1), 'a0000000-0000-0000-0000-00000000000a', 'rechazado', null)$q$, 'no se puede rechazar');
select pg_temp.espera_error($q$select public.wa_cambiar_estado((select id from public.wa_pedidos where numero = 2), 'a0000000-0000-0000-0000-00000000000a', 'aceptado', null)$q$, 'terminado');
select pg_temp.espera_error($q$select public.wa_cambiar_estado((select id from public.wa_pedidos where numero = 1), 'b0000000-0000-0000-0000-00000000000b', 'en_camino', null)$q$, 'No encontramos');
select pg_temp.espera_error($q$select public.wa_cambiar_estado((select id from public.wa_pedidos where numero = 1), 'a0000000-0000-0000-0000-00000000000a', 'cualquiera', null)$q$, 'ya pasó');

-- Fila de mensajes seguidos: solo el último los toma todos, una sola vez.
do $$
declare c jsonb;
begin
  perform public.wa_encolar('a0000000-0000-0000-0000-00000000000a', '5493850000009', 'Juan', 'm1', 'hola', null);
  perform public.wa_encolar('a0000000-0000-0000-0000-00000000000a', '5493850000009', null, 'm2', 'quiero 2 lomitos', '{"lat":1,"lng":2}');
  if public.wa_tomar('a0000000-0000-0000-0000-00000000000a', '5493850000009', 'm1') is not null then raise exception 'el primero no debería contestar'; end if;
  c := public.wa_tomar('a0000000-0000-0000-0000-00000000000a', '5493850000009', 'm2');
  if jsonb_array_length(c->'pendientes') <> 2 or c->>'nombre' <> 'Juan' or c->'ubicacion'->>'lat' <> '1' then raise exception 'fila mal: %', c; end if;
  if public.wa_tomar('a0000000-0000-0000-0000-00000000000a', '5493850000009', 'm2') is not null then raise exception 'se contestó dos veces'; end if;
end $$;
update public.wa_charlas set necesita_humano = 'Quiere hablar con alguien', historial = '[{"role":"user"}]' where telefono = '5493850000009';

-- Desde la app: el dueño ve lo suyo y solo puede reactivar charlas; nadie más ve nada.
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  if (select count(*) from public.wa_pedidos) <> 2 then raise exception 'El dueño no ve sus pedidos'; end if;
  if (select count(*) from public.wa_charlas where necesita_humano is not null) <> 1 then raise exception 'El dueño no ve la charla'; end if;
end $$;
update public.wa_charlas set necesita_humano = null, pausada_hasta = null where telefono = '5493850000009';
select pg_temp.espera_error($q$update public.wa_charlas set historial = '[]'$q$, 'permission denied');
select pg_temp.espera_error($q$update public.wa_pedidos set total = 1$q$, 'permission denied');
select pg_temp.espera_error($q$insert into public.wa_pedidos (negocio_id, numero, telefono, renglones, subtotal, total, entrega) values ('a0000000-0000-0000-0000-00000000000a', 99, '1', '[]', 1, 1, 'retiro')$q$, 'permission denied');
select pg_temp.espera_error($q$select public.wa_cambiar_estado((select id from public.wa_pedidos where numero = 1), 'a0000000-0000-0000-0000-00000000000a', 'en_camino', null)$q$, 'permission denied');
select pg_temp.espera_error($q$select public.wa_registrar_pedido('venutto','1',null,'[{"producto":"mpote","cantidad":1}]','retiro','efectivo',null,null,null)$q$, 'permission denied');
select pg_temp.espera_error($q$select public.wa_contexto('venutto')$q$, 'permission denied');
select pg_temp.espera_error($q$select * from public.wa_mensajes$q$, 'permission denied');

select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  if (select count(*) from public.wa_pedidos) <> 0 or (select count(*) from public.wa_charlas) <> 0 then raise exception 'Otro negocio ve pedidos ajenos'; end if;
end $$;
set role anon;
select pg_temp.espera_error($q$select * from public.wa_pedidos$q$, 'permission denied');
reset role;
do $$ begin
  if (select necesita_humano from public.wa_charlas where telefono = '5493850000009') is not null then raise exception 'El dueño no pudo reactivar la charla'; end if;
end $$;
