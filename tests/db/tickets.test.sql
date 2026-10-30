-- Pruebas de tickets.sql. Corre después de caja.test.sql y menu.test.sql (usa sus negocios y productos:
-- A = Venutto con 'lomito' $10.000 (opción pan árabe +$100) y 'mayo' $500; B = Otro; C = Vencido).
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
create temp table tk (token text);
grant all on tk to anon, authenticated;

-- ---------- El dueño arma el ticket ----------
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare t jsonb;
begin
  -- 2 lomitos con pan árabe + 1 pote, envío $1.500. Los precios que manda el celular se ignoran.
  t := public.guardar_ticket('77777777-0000-0000-0000-000000000001',
    '[{"producto":"lomito","opcion":"arabe","cantidad":2,"precio_unitario":1},{"producto":"mayo","cantidad":1}]', 1500, ' Juan ', '');
  if (t->>'numero')::int <> 1 then raise exception 'Número: %', t; end if;
  if (t->>'subtotal')::numeric <> 20700 or (t->>'total')::numeric <> 22200 then raise exception 'Total mal: %', t; end if;
  if t->'items'->0->>'nombre' <> 'Lomito completo' or t->'items'->0->>'opcion_nombre' <> 'pan árabe' or (t->'items'->0->>'precio_unitario')::numeric <> 10100 then
    raise exception 'Renglón mal: %', t->'items'->0;
  end if;
  if t->>'cliente' <> 'Juan' or t->>'nota' is not null or t->>'estado' <> 'pendiente' then raise exception 'Datos mal: %', t; end if;
  if length(t->>'token') < 20 or t->>'token' ~ '[+/=]' then raise exception 'Token mal: %', t->>'token'; end if;
  insert into tk values (t->>'token');

  -- Reintento con el mismo id: no crea otro, corrige el mismo (sube la versión, mismo link).
  t := public.guardar_ticket('77777777-0000-0000-0000-000000000001', '[{"producto":"lomito","cantidad":1}]', null);
  if (t->>'numero')::int <> 1 or (t->>'version')::int <> 2 or (t->>'total')::numeric <> 10000 or t->>'envio' is not null then raise exception 'Corrección mal: %', t; end if;
  if t->>'token' <> (select token from tk) then raise exception 'La corrección cambió el link'; end if;
  if (select count(*) from public.tickets) <> 1 then raise exception 'Se duplicó el ticket'; end if;

  -- Retira en el local (sin envío) y numeración seguida.
  t := public.guardar_ticket('77777777-0000-0000-0000-000000000002', '[{"producto":"mayo","cantidad":3}]', null);
  if (t->>'numero')::int <> 2 or (t->>'total')::numeric <> 1500 then raise exception 'Segundo ticket mal: %', t; end if;
end $$;
select pg_temp.espera_error($q$select public.guardar_ticket(gen_random_uuid(), '[]', null)$q$, 'al menos un producto');
select pg_temp.espera_error($q$select public.guardar_ticket(gen_random_uuid(), '[{"producto":"mayocasera","cantidad":1}]', null)$q$, 'ya no existe');
select pg_temp.espera_error($q$select public.guardar_ticket(gen_random_uuid(), '[{"producto":"sinprecio","cantidad":1}]', null)$q$, 'no tiene precio');
select pg_temp.espera_error($q$select public.guardar_ticket(gen_random_uuid(), '[{"producto":"lomito","opcion":"nada","cantidad":1}]', null)$q$, 'opción');
select pg_temp.espera_error($q$select public.guardar_ticket(gen_random_uuid(), '[{"producto":"lomito","cantidad":0}]', null)$q$, 'cantidades');
select pg_temp.espera_error($q$select public.guardar_ticket(gen_random_uuid(), '[{"producto":"lomito","cantidad":1}]', -5)$q$, 'envío');
select pg_temp.espera_error($q$insert into public.tickets (id, negocio_id, numero, token, items, subtotal, total) values (gen_random_uuid(), 'a0000000-0000-0000-0000-00000000000a', 99, 'x', '[]', 0, 0)$q$, 'permission denied');

-- ---------- Otro negocio no ve ni toca los tickets de A ----------
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  if (select count(*) from public.tickets) <> 0 then raise exception 'B ve tickets de A'; end if;
end $$;
select pg_temp.espera_error($q$select public.guardar_ticket('77777777-0000-0000-0000-000000000001', '[{"producto":"botro","cantidad":1}]', null)$q$, 'no es de tu negocio');
select pg_temp.espera_error($q$select public.guardar_ticket(gen_random_uuid(), '[{"producto":"mcompleto","cantidad":1}]', null)$q$, 'ya no existe');
-- Negocio vencido: no puede armar tickets.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false);
select pg_temp.espera_error($q$select public.guardar_ticket(gen_random_uuid(), '[{"producto":"cvencido","cantidad":1}]', null)$q$, 'no tiene acceso');

-- ---------- El cliente (sin login) ----------
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare v jsonb; tok text := (select token from tk);
begin
  v := public.ver_ticket(tok);
  if v->'negocio'->>'nombre' <> 'Venutto' or (v->'ticket'->>'total')::numeric <> 10000 or (v->'ticket'->>'version')::int <> 2 then raise exception 'ver_ticket mal: %', v; end if;
  if v->'pago'->>'alias' <> 'javier.toledo.nx' or v->'pago'->>'whatsapp' <> '5493855702807' then raise exception 'Datos de pago mal: %', v->'pago'; end if;
  if v::text ~* 'costo|margen|receta|negocio_id|token|items":\[\{[^]]*insumo' then raise exception 'El ticket expone datos internos: %', v; end if;
  if public.ver_ticket('no-existe') is not null or public.ver_ticket(null) is not null then raise exception 'Ticket inexistente visible'; end if;

  -- Responde mirando una versión vieja: se le avisa que cambió.
  begin
    perform public.responder_ticket(tok, 'aceptado', 1);
    raise exception 'Aceptó una versión vieja';
  exception when others then
    if sqlerrm not like '%corrigió el ticket%' then raise; end if;
  end;
  begin
    perform public.responder_ticket(tok, 'cambio', 2, '  ');
    raise exception 'Pidió cambio sin decir qué';
  exception when others then
    if sqlerrm not like '%qué querés cambiar%' then raise; end if;
  end;
  v := public.responder_ticket(tok, 'cambio', 2, 'Sin huevo y agregá un pote');
  if v->'ticket'->>'estado' <> 'cambio' or v->'ticket'->>'respuesta' <> 'Sin huevo y agregá un pote' then raise exception 'Cambio mal: %', v; end if;
  v := public.responder_ticket(tok, 'cambio', 2, 'Sin huevo y agregá un pote');   -- doble toque
  begin
    perform public.responder_ticket(tok, 'aceptado', 2);
    raise exception 'Respondió dos veces';
  exception when others then
    if sqlerrm not like '%ya fue respondido%' then raise; end if;
  end;
end $$;
select pg_temp.espera_error($q$select public.guardar_ticket(gen_random_uuid(), '[{"producto":"lomito","cantidad":1}]', null)$q$, 'permission denied');
select pg_temp.espera_error($q$select * from public.tickets$q$, 'permission denied');

-- ---------- El dueño ve el pedido de cambio, corrige, y el cliente acepta ----------
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare t jsonb;
begin
  if (select estado || '|' || respuesta from public.tickets where numero = 1) <> 'cambio|Sin huevo y agregá un pote' then raise exception 'El dueño no ve el pedido de cambio'; end if;
  t := public.guardar_ticket('77777777-0000-0000-0000-000000000001', '[{"producto":"lomito","cantidad":1},{"producto":"mayo","cantidad":1}]', 1500, 'Juan', 'Sin huevo');
  if t->>'estado' <> 'pendiente' or (t->>'version')::int <> 3 or (t->>'total')::numeric <> 12000 then raise exception 'Corrección mal: %', t; end if;
end $$;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare v jsonb := public.responder_ticket((select token from tk), 'aceptado', 3);
begin
  if v->'ticket'->>'estado' <> 'aceptado' or v->'ticket'->>'respondido_en' is null then raise exception 'Aceptar mal: %', v; end if;
end $$;
-- Aceptado: ya no se corrige.
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select pg_temp.espera_error($q$select public.guardar_ticket('77777777-0000-0000-0000-000000000001', '[{"producto":"lomito","cantidad":1}]', null)$q$, 'ya respondió');
reset role;
