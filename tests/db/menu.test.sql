-- Pruebas de menu.sql: el menú público solo ve lo autorizado y los importes salen de la base.
-- Corre después de caja.test.sql (usa sus negocios A = Venutto, B = Otro, C = Vencido).
reset role;
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
create or replace function pg_temp.no_contiene(j jsonb, palabras text[]) returns void language plpgsql as $$
declare w text;
begin
  foreach w in array palabras loop
    if position(lower(w) in lower(j::text)) > 0 then raise exception 'El menú público expone "%": %', w, j; end if;
  end loop;
end $$;
grant execute on function pg_temp.no_contiene(jsonb, text[]) to anon, authenticated;
-- Como en Supabase: los roles tienen permiso sobre las tablas y lo que frena es RLS.
grant select, insert, update, delete on public.productos, public.ajustes, public.negocios to anon, authenticated;

insert into public.productos (negocio_id, id, datos) values
  ('a0000000-0000-0000-0000-00000000000a', 'mcompleto', '{"nombre":"Lomito completo","plural":"Lomitos completos","categoria":"Lomitos","precioVenta":10000,
     "enMenu":true,"descripcion":"Con jamón, queso y huevo.","foto":"https://x.supabase.co/storage/v1/object/public/menu-fotos/a/completo.jpg",
     "margen":35,"envioIncluido":1000,"items":[{"insumo":"carne-secreta","cantidad":180}],
     "opciones":[{"id":"arabe","nombre":"Pan árabe","reemplaza":"pan-frances","por":"pan-arabe","precioExtra":200}]}'),
  ('a0000000-0000-0000-0000-00000000000a', 'mpote', '{"nombre":"Potecito de mayonesa","plural":"Potecitos de mayonesa","tipo":"extra","precioVenta":500,"enMenu":true,"items":[]}'),
  ('a0000000-0000-0000-0000-00000000000a', 'mpromo', '{"nombre":"Promo 2 completas","tipo":"promo","categoria":"Hamburguesas","precioVenta":12000,"enMenu":true}'),
  ('a0000000-0000-0000-0000-00000000000a', 'magotado', '{"nombre":"Lomito picante","categoria":"Lomitos","precioVenta":10000,"enMenu":true,"agotado":true}'),
  ('a0000000-0000-0000-0000-00000000000a', 'mnomenu', '{"nombre":"Lomito interno","categoria":"Lomitos","precioVenta":9000}'),
  ('a0000000-0000-0000-0000-00000000000a', 'mprep', '{"nombre":"Mayonesa casera","esPreparacion":true,"enMenu":true,"precioVenta":100}'),
  ('a0000000-0000-0000-0000-00000000000a', 'msinprecio', '{"nombre":"Burger nueva","enMenu":true,"precioVenta":null}'),
  ('a0000000-0000-0000-0000-00000000000a', 'mfoto', '{"nombre":"Con foto rara","enMenu":true,"precioVenta":100,"foto":"javascript:alert(1)"}'),
  ('b0000000-0000-0000-0000-00000000000b', 'botro', '{"nombre":"Producto de otro","precioVenta":1,"enMenu":true}'),
  ('c0000000-0000-0000-0000-00000000000c', 'cvencido', '{"nombre":"Producto vencido","precioVenta":1,"enMenu":true}');
insert into public.ajustes (negocio_id, id, datos) values
  ('c0000000-0000-0000-0000-00000000000c', 'menu', '{"publicado":true,"slug":"vencido"}');

-- Sin publicar todavía: el menú no existe.
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  if public.menu_publico('venutto') is not null then raise exception 'Menú visible sin publicar'; end if;
  if public.menu_publico('vencido') is not null then raise exception 'Menú visible con el negocio vencido'; end if;
end $$;
select pg_temp.espera_error($q$select public.cotizar_pedido('venutto', '[{"producto":"mcompleto","cantidad":1}]', 'retiro')$q$, 'no está disponible');

-- El dueño publica el menú desde Mi negocio (escribe ajustes como siempre, con RLS).
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
insert into public.ajustes (negocio_id, id, datos) values ('a0000000-0000-0000-0000-00000000000a', 'menu',
  '{"publicado":true,"slug":"venutto","whatsapp":"+54 9 385 570-2807","alias":"javier.toledo.nx","pagos":["transferencia","efectivo","dividido","bitcoin"],
    "envio":1000,"horarios":{"dias":[4,5,6,0],"desde":"21:00","hasta":"01:00"}}');

-- Otro negocio no puede usar el mismo slug.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
select pg_temp.espera_error($q$insert into public.ajustes (negocio_id, id, datos) values ('b0000000-0000-0000-0000-00000000000b', 'menu', '{"publicado":true,"slug":"VENUTTO"}')$q$, 'duplicate');

set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare r jsonb; ids text;
begin
  r := public.menu_publico('Venutto');
  if r is null then raise exception 'menu_publico no devolvió el menú publicado'; end if;
  select string_agg(p->>'id', ',' order by p->>'id') into ids from jsonb_array_elements(r->'productos') p;
  -- Solo los marcados para el menú, con precio, que no son preparaciones, de este negocio.
  if ids <> 'magotado,mcompleto,mfoto,mpote,mpromo' then raise exception 'Productos publicados: %', ids; end if;
  perform pg_temp.no_contiene(r, array['margen','envioIncluido','items','insumo','carne-secreta','reemplaza','pan-frances','costo','caja','Lomito interno','Producto de otro','owner','suscripcion','prueba_hasta']);
  if r->'menu'->>'whatsapp' <> '5493855702807' then raise exception 'whatsapp: %', r->'menu'; end if;
  if r->'menu'->'pagos' <> '["transferencia","efectivo","dividido"]'::jsonb then raise exception 'pagos: %', r->'menu'->'pagos'; end if;
  if (r->'menu'->>'envio')::numeric <> 1000 or r->'menu'->'horarios'->'dias' <> '[0,4,5,6]'::jsonb then raise exception 'envío u horarios: %', r->'menu'; end if;
  select p into r from jsonb_array_elements(public.menu_publico('venutto')->'productos') p where p->>'id' = 'mcompleto';
  if r <> '{"id":"mcompleto","nombre":"Lomito completo","plural":"Lomitos completos","descripcion":"Con jamón, queso y huevo.",
            "foto":"https://x.supabase.co/storage/v1/object/public/menu-fotos/a/completo.jpg","tipo":"producto","categoria":"Lomitos",
            "precio":10000,"disponible":true,"opciones":[{"id":"arabe","nombre":"Pan árabe","precio_extra":200}]}'::jsonb then
    raise exception 'Producto publicado: %', r;
  end if;
  select p into r from jsonb_array_elements(public.menu_publico('venutto')->'productos') p where p->>'id' = 'mfoto';
  if r->'foto' <> 'null'::jsonb then raise exception 'Foto que no es https publicada: %', r; end if;
  select p into r from jsonb_array_elements(public.menu_publico('venutto')->'productos') p where p->>'id' = 'magotado';
  if (r->>'disponible')::boolean then raise exception 'Agotado figura disponible'; end if;
end $$;

-- Sin login no se leen las tablas ni las funciones internas.
do $$ begin
  if exists (select 1 from public.productos) or exists (select 1 from public.ajustes) or exists (select 1 from public.negocios) then
    raise exception 'Sin login se leen tablas internas';
  end if;
end $$;
select pg_temp.espera_error($q$select * from public.menu_negocio('venutto')$q$, 'permission denied');
select pg_temp.espera_error($q$select public.menu_producto('x', '{}')$q$, 'permission denied');

-- Cotizar: importes de la base, opción con su precio, envío fijo en delivery, nada en retiro.
do $$
declare r jsonb;
begin
  r := public.cotizar_pedido('venutto', '[{"producto":"mcompleto","cantidad":2},{"producto":"mcompleto","opcion":"arabe","cantidad":1},
                                          {"producto":"mpote","cantidad":3},{"producto":"mpromo","cantidad":1}]', 'delivery');
  if (r->>'subtotal')::numeric <> 2*10000 + 10200 + 3*500 + 12000 or (r->>'envio')::numeric <> 1000
     or (r->>'total')::numeric <> 44700 or (r->>'envio_a_confirmar')::boolean or jsonb_array_length(r->'errores') <> 0 then
    raise exception 'cotizar delivery: %', r;
  end if;
  if r->'renglones'->1->>'opcion_nombre' <> 'Pan árabe' or (r->'renglones'->1->>'precio_unitario')::numeric <> 10200
     or r->'renglones'->2->>'plural' <> 'Potecitos de mayonesa' then raise exception 'renglones: %', r->'renglones'; end if;
  perform pg_temp.no_contiene(r, array['margen','costo','insumo','reemplaza']);
  r := public.cotizar_pedido('venutto', '[{"producto":"mpote","cantidad":1}]', 'retiro');
  if r->'envio' <> 'null'::jsonb or (r->>'total')::numeric <> 500 then raise exception 'cotizar retiro: %', r; end if;
  -- Lo que no se puede vender vuelve como error, sin sumar.
  r := public.cotizar_pedido('venutto', '[{"producto":"magotado","cantidad":1},{"producto":"mnomenu","cantidad":1},{"producto":"botro","cantidad":1},
     {"producto":"mprep","cantidad":1},{"producto":"mcompleto","cantidad":0},{"producto":"mcompleto","cantidad":1.5},{"producto":"mcompleto","cantidad":100},
     {"producto":"mcompleto","cantidad":"-1"},{"producto":"mcompleto","opcion":"inventada","cantidad":1}]', 'retiro');
  if jsonb_array_length(r->'errores') <> 9 or jsonb_array_length(r->'renglones') <> 0 or (r->>'total')::numeric <> 0 then raise exception 'errores: %', r; end if;
  if r->'errores'->0->>'error' <> 'agotado' or r->'errores'->1->>'error' <> 'no_existe' or r->'errores'->2->>'error' <> 'no_existe'
     or r->'errores'->4->>'error' <> 'cantidad' or r->'errores'->8->>'error' <> 'opcion' then raise exception 'tipos de error: %', r->'errores'; end if;
end $$;
select pg_temp.espera_error($q$select public.cotizar_pedido('venutto', '[]', 'retiro')$q$, 'vacío');
select pg_temp.espera_error($q$select public.cotizar_pedido('venutto', '[{"producto":"mpote","cantidad":1}]', 'avion')$q$, 'delivery o retiro');

-- Cambio de precio en la calculadora → el menú y la cotización lo toman en el próximo pedido de datos.
create temp table version_antes as select public.menu_publico('venutto')->>'version' as v;
grant select on version_antes to authenticated, anon;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
update public.productos set datos = jsonb_set(datos, '{precioVenta}', '11500') where id = 'mcompleto';
update public.productos set datos = jsonb_set(datos, '{opciones,0,precioExtra}', '300') where id = 'mcompleto';
update public.productos set datos = jsonb_set(datos, '{precioVenta}', '13000') where id = 'mpromo';
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare r jsonb; p jsonb;
begin
  r := public.menu_publico('venutto');
  if r->>'version' = (select v from version_antes) then raise exception 'La versión no cambió con el precio nuevo'; end if;
  select x into p from jsonb_array_elements(r->'productos') x where x->>'id' = 'mcompleto';
  if (p->>'precio')::numeric <> 11500 or (p->'opciones'->0->>'precio_extra')::numeric <> 300 then raise exception 'precio nuevo no publicado: %', p; end if;
  r := public.cotizar_pedido('venutto', '[{"producto":"mcompleto","opcion":"arabe","cantidad":2},{"producto":"mpromo","cantidad":1}]', 'retiro');
  if (r->>'total')::numeric <> 2*11800 + 13000 then raise exception 'cotización con precio viejo: %', r; end if;
end $$;

-- Si el dueño despublica, el menú deja de verse.
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
update public.ajustes set datos = jsonb_set(datos, '{publicado}', 'false') where id = 'menu' and negocio_id = 'a0000000-0000-0000-0000-00000000000a';
set role anon;
do $$ begin
  if public.menu_publico('venutto') is not null then raise exception 'Menú visible despublicado'; end if;
end $$;
reset role;
